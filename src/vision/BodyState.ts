import { BODY } from '../config/GameConfig';
import type {
  AirPhase,
  BodyFrame,
  BodyThresholds,
  CrouchPhase,
  Lane,
  PoseSample,
  StarGeometry,
} from '../core/types';
import { OneEuroFilter } from './OneEuroFilter';
import { starScore } from './PoseFeatures';
import { classifyLane, laneSignal, RunCadence, type PoseProfile } from './PoseProfile';

/**
 * Turns per-frame landmarks into body state: feet on the floor or in the air,
 * crouch held, run cadence, lane, and star shape. Gameplay, calibration, and
 * replay all run this same class, so they agree on what a jump or duck is.
 */
export class BodyState {
  private profile: PoseProfile;
  private thresholds: BodyThresholds;

  private floorY = 0;
  private noseY0 = 0;
  private hipY0 = 0;
  private legLength = 0.4;

  private readonly noseF = verticalFilter();
  private readonly hipF = verticalFilter();
  private readonly ankleLF = verticalFilter();
  private readonly ankleRF = verticalFilter();
  private readonly laneF = new OneEuroFilter(BODY.LANE_MIN_CUTOFF, BODY.LANE_BETA, BODY.LANE_D_CUTOFF);
  private readonly cadence = new RunCadence();

  private airborne = false;
  private airStart = 0;
  private airPeak = 0;
  private starFrames = 0;
  private starBest: StarGeometry | null = null;
  private starBestScore = -Infinity;
  private starJumpedThisAir = false;

  private crouching = false;
  private crouchFrames = 0;
  private crouchStart = 0;
  private crouchPeak = 0;

  private landedAt = -Infinity;
  private jumpArmed = true;
  private earlyAt: number | null = null;
  private hipRiseAt = -Infinity;
  private hipPeak = 0;
  private hipHistory: Array<{ t: number; lift: number }> = [];

  private lastT: number | null = null;
  private lastValidAt = -Infinity;
  private last: BodyFrame;

  constructor(profile: PoseProfile) {
    this.profile = profile;
    this.thresholds = { ...profile.thresholds };
    this.last = emptyFrame(0);
    this.setProfile(profile);
  }

  setProfile(profile: PoseProfile): void {
    this.profile = profile;
    this.thresholds = { ...profile.thresholds };
    this.reset();
  }

  /** Calibration uses provisional thresholds while it measures the real ones. */
  setThresholds(partial: Partial<BodyThresholds>): void {
    this.thresholds = { ...this.thresholds, ...partial };
  }

  getThresholds(): BodyThresholds {
    return { ...this.thresholds };
  }

  reset(): void {
    const b = this.profile.baseline;
    this.floorY = b.floorY;
    this.noseY0 = b.noseY;
    this.hipY0 = b.hipY;
    this.legLength = Math.max(0.05, b.legLength);
    for (const f of [this.noseF, this.hipF, this.ankleLF, this.ankleRF, this.laneF]) f.reset();
    this.cadence.reset();
    this.airborne = false;
    this.crouching = false;
    this.crouchFrames = 0;
    this.landedAt = -Infinity;
    this.jumpArmed = true;
    this.earlyAt = null;
    this.hipRiseAt = -Infinity;
    this.hipPeak = 0;
    this.hipHistory = [];
    this.lastT = null;
    this.lastValidAt = -Infinity;
    this.last = emptyFrame(0);
  }

  update(sample: PoseSample | null, t: number): BodyFrame {
    const valid = !!sample && sample.hipMidY !== null;
    if (!valid || !sample) {
      if (t - this.lastValidAt > BODY.LOST_RESET_MS) {
        this.airborne = false;
        this.crouching = false;
        this.crouchFrames = 0;
      }
      this.last = {
        ...this.last,
        t,
        valid: false,
        airborne: this.airborne,
        crouching: this.crouching,
        jumped: false,
        jumpCue: null,
        landed: false,
        starJumped: false,
        airPhase: null,
        crouchPhase: null,
      };
      return this.last;
    }

    const dtMs = this.lastT === null ? 0 : t - this.lastT;
    this.lastT = t;
    this.lastValidAt = t;
    const th = this.thresholds;

    const nose = this.noseF.filter(sample.noseY, t);
    const hip = this.hipF.filter(sample.hipMidY!, t);
    const L = this.legLength;

    // A missing foot is unknown. Do not read the filter: its last value is the floor.
    const feetKnown = sample.footLY !== null && sample.footRY !== null;
    let ankleLift = 0;
    if (feetKnown) {
      const footL = this.ankleLF.filter(sample.footLY!, t);
      const footR = this.ankleRF.filter(sample.footRY!, t);
      ankleLift = Math.min(this.floorY - footL, this.floorY - footR) / L;
    }
    const hipLift = (this.hipY0 - hip) / L;
    const hipVel = -this.hipF.velocity / L;
    if (hipVel > BODY.HIP_CUE_VEL) this.hipRiseAt = t;
    const crouchDepth = (nose - this.noseY0) / L;

    const laneRaw = laneSignal(sample);
    const laneFiltered = this.laneF.filter(laneRaw, t);
    const lane: Lane = classifyLane(laneFiltered, this.profile.lanes);

    const runIntensity = this.cadence.update(sample, this.profile.baseline.torsoHeight);
    const running = runIntensity >= th.runCadence;

    this.hipHistory.push({ t, lift: hipLift });
    while (this.hipHistory.length > 0 && t - this.hipHistory[0]!.t > BODY.TAKEOFF_DIP_WINDOW_MS) {
      this.hipHistory.shift();
    }
    // A wind-up is a quick dip from standing. A held crouch has no standing
    // sample before its low point inside the window, so rising from it is not a takeoff.
    let recentMinLift = Infinity;
    let standingBeforeMin = false;
    let standingSoFar = false;
    for (const h of this.hipHistory) {
      if (h.lift > -BODY.TAKEOFF_DIP * 0.5) standingSoFar = true;
      if (h.lift < recentMinLift) {
        recentMinLift = h.lift;
        standingBeforeMin = standingSoFar;
      }
    }

    let jumped = false;
    let jumpCue: BodyFrame['jumpCue'] = null;
    let landed = false;
    let starJumped = false;
    let airPhase: AirPhase | null = null;
    let crouchPhase: CrouchPhase | null = null;

    // Feet cue: both feet seen this frame and above the floor. Running keeps one down.
    // Hip cue: hips clear hipJump right after an upward push. Either one is enough.
    // Veto: both feet are confidently on the floor this frame (tiptoe or sway).
    const feetUp = feetKnown && ankleLift > th.airLift && hipLift > -BODY.AIR_HIP_TOL;
    const recentRise = t - this.hipRiseAt <= BODY.HIP_CUE_WINDOW_MS;
    const hipsUp = hipLift > th.hipJump && recentRise;
    const feetOnFloor = sample.feetConfident && feetKnown && ankleLift <= th.airLift;
    const feetCue = feetUp && !feetOnFloor;
    const hipCue = hipsUp && !feetOnFloor;

    if (!this.airborne) {
      if (feetCue || hipCue) {
        this.airborne = true;
        this.airStart = t;
        this.airPeak = feetKnown ? ankleLift : 0;
        this.hipPeak = hipLift;
        this.starFrames = 0;
        this.starBest = null;
        this.starBestScore = -Infinity;
        this.starJumpedThisAir = false;
        this.earlyAt = null;
        if (this.jumpArmed) {
          jumped = true;
          jumpCue = feetCue && hipCue ? 'both' : feetCue ? 'feet' : 'hips';
          this.jumpArmed = false;
        }
      }
    } else {
      if (feetKnown) this.airPeak = Math.max(this.airPeak, ankleLift);
      this.hipPeak = Math.max(this.hipPeak, hipLift);
      const timedOut = t - this.airStart > BODY.AIR_MAX_MS;
      const feetDown = feetKnown && ankleLift < th.airLift * BODY.AIR_RELEASE;
      const hipsDown = !feetKnown && hipLift < th.hipJump * BODY.HIP_RELEASE;
      if (feetDown || hipsDown || timedOut) {
        this.airborne = false;
        landed = true;
        this.landedAt = t;
        if (!timedOut) {
          airPhase = {
            peakLift: this.airPeak,
            peakHip: this.hipPeak,
            durationMs: t - this.airStart,
            starBest: this.starBest,
            starFrames: this.starFrames,
          };
        }
      }
    }

    // Early takeoff: the push after a wind-up dip, a frame or two before the feet leave.
    // Rising out of a landing dip is not a wind-up, so the landing must be out of the window.
    if (
      BODY.TAKEOFF_EARLY &&
      !this.airborne &&
      this.jumpArmed &&
      !jumped &&
      t - this.landedAt > BODY.TAKEOFF_DIP_WINDOW_MS &&
      hipVel > BODY.TAKEOFF_VEL &&
      recentMinLift < -BODY.TAKEOFF_DIP &&
      standingBeforeMin &&
      hipLift > -BODY.TAKEOFF_DIP
    ) {
      jumped = true;
      jumpCue = 'hips';
      this.jumpArmed = false;
      this.earlyAt = t;
    }

    if (!this.jumpArmed && !this.airborne) {
      if (this.earlyAt !== null) {
        if (t - this.earlyAt > BODY.TAKEOFF_CONFIRM_MS) {
          this.jumpArmed = true;
          this.earlyAt = null;
        }
      } else if (t - this.landedAt >= BODY.JUMP_REARM_MS) {
        this.jumpArmed = true;
      }
    }

    // Star jump: star shape while airborne, on enough frames of one jump.
    const star = sample.star;
    const score = star ? starScore(star, th.starArm, th.starSpread) : 0;
    const starOk = score >= 1;
    if (this.airborne) {
      if (star && score > this.starBestScore) {
        this.starBestScore = score;
        this.starBest = star;
      }
      if (starOk) {
        this.starFrames += 1;
        if (this.starFrames >= BODY.STAR_JUMP_FRAMES && !this.starJumpedThisAir) {
          starJumped = true;
          this.starJumpedThisAir = true;
        }
      }
    }

    // Crouch: head down with feet planted, held. The landing dip is ignored briefly.
    // Unknown feet are not "planted" — a stale floor reading must not start a duck.
    const feetDown = feetKnown && ankleLift < th.airLift;
    const inLandingLockout =
      t - this.landedAt < BODY.LANDING_MS && crouchDepth < th.crouch * 1.5;
    if (!this.crouching) {
      if (!this.airborne && feetDown && !inLandingLockout && crouchDepth > th.crouch) {
        this.crouchFrames += 1;
        if (this.crouchFrames >= BODY.CROUCH_FRAMES) {
          this.crouching = true;
          this.crouchStart = t;
          this.crouchPeak = crouchDepth;
        }
      } else {
        this.crouchFrames = 0;
      }
    } else {
      this.crouchPeak = Math.max(this.crouchPeak, crouchDepth);
      if (this.airborne || crouchDepth < th.crouch * BODY.CROUCH_RELEASE) {
        this.crouching = false;
        this.crouchFrames = 0;
        crouchPhase = { peakDepth: this.crouchPeak, durationMs: t - this.crouchStart };
      }
    }

    // Follow slow drift (stepping closer or back) only while standing calmly.
    const calm =
      feetKnown &&
      !this.airborne &&
      !this.crouching &&
      Math.abs(crouchDepth) < th.crouch * 0.4 &&
      ankleLift < th.airLift * 0.5 &&
      Math.abs(hipVel) < 0.3;
    if (calm && dtMs > 0) {
      const k = 1 - Math.exp(-dtMs / BODY.BASELINE_TAU_MS);
      const floorNow = Math.max(this.ankleLF.value ?? this.floorY, this.ankleRF.value ?? this.floorY);
      this.floorY += (floorNow - this.floorY) * k;
      this.noseY0 += (nose - this.noseY0) * k;
      this.hipY0 += (hip - this.hipY0) * k;
      this.legLength += (Math.max(0.05, floorNow - hip) - this.legLength) * k;
    }

    this.last = {
      t,
      valid: true,
      hipLift,
      hipVel,
      ankleLift,
      crouchDepth,
      airborne: this.airborne,
      crouching: this.crouching,
      runIntensity,
      running,
      star,
      starOk,
      starScore: score,
      lane,
      laneSignal: laneFiltered,
      jumped,
      jumpCue,
      landed,
      starJumped,
      airPhase,
      crouchPhase,
    };
    return this.last;
  }
}

function verticalFilter(): OneEuroFilter {
  return new OneEuroFilter(BODY.FILTER_MIN_CUTOFF, BODY.FILTER_BETA, BODY.FILTER_D_CUTOFF);
}

function emptyFrame(t: number): BodyFrame {
  return {
    t,
    valid: false,
    hipLift: 0,
    hipVel: 0,
    ankleLift: 0,
    crouchDepth: 0,
    airborne: false,
    crouching: false,
    runIntensity: 0,
    running: false,
    star: null,
    starOk: false,
    starScore: 0,
    lane: 0,
    laneSignal: 0.5,
    jumped: false,
    jumpCue: null,
    landed: false,
    starJumped: false,
    airPhase: null,
    crouchPhase: null,
  };
}

/** Avatar squash 0..1 from crouch depth, with a dead zone so running bob stays still. */
export function crouchDepth01(depth: number, threshold: number): number {
  const t = Math.max(0.01, threshold);
  return Math.max(0, Math.min(1, (depth - 0.35 * t) / (1.15 * t)));
}
