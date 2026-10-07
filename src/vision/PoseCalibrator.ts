import { BODY, CALIBRATION, VISION } from '../config/GameConfig';
import type { EventBus } from '../core/EventBus';
import type {
  BodyFrame,
  CalibrationFeedback,
  CalibrationStepId,
  CalibrationUpdate,
  GameEvents,
  PoseSample,
} from '../core/types';
import { BodyState } from './BodyState';
import { defaultProfile, laneSignal, RunCadence, type PoseProfile } from './PoseProfile';

const STEPS: CalibrationStepId[] = [
  'stand',
  'lane_left',
  'lane_right',
  'jump',
  'duck',
  'run',
  'star_jump',
];

const FEET_HINT = 'Step back so your feet are visible';

interface StillSample {
  shoulderY: number;
  torso: number;
  noseY: number;
  hipY: number;
  floorY: number;
  lane: number;
  spread: number;
}

/**
 * Seven prompts. Each one ends as soon as its measurement is captured, and
 * jump, duck, and star jump reps are counted by the same BodyState detectors
 * the game uses, so a rep that counts here triggers in a run.
 */
export class PoseCalibrator {
  private readonly bus: EventBus<GameEvents>;
  private readonly cadence = new RunCadence();
  private unsubscribeFrame: (() => void) | null = null;
  private active = false;
  private step: CalibrationStepId = 'stand';
  private stepStartedAt = 0;
  private onComplete: ((profile: PoseProfile | null) => void) | null = null;

  /** Profile under construction; BodyState reads it from step 2 on. */
  private profile: PoseProfile = defaultProfile();
  private body: BodyState | null = null;
  private idleLevel = 0;
  private leftX: number | null = null;

  /** Set when a step is done: its final state stays on screen until this time. */
  private completeUntil: number | null = null;
  private completeFeedback: CalibrationFeedback | null = null;

  private still: StillSample[] = [];
  private stillSince: number | null = null;

  private holdStartedAt: number | null = null;
  private holdAnchor: number | null = null;
  private holdSum = 0;
  private holdCount = 0;

  private repValues: number[] = [];
  private jumpReps: Array<{ foot: number; hip: number }> = [];
  private starReps: Array<{ arm: number; spread: number }> = [];

  private runHoldStart: number | null = null;
  private runBelowSince: number | null = null;
  private runSamples: number[] = [];

  constructor(bus: EventBus<GameEvents>) {
    this.bus = bus;
  }

  start(onComplete: (profile: PoseProfile | null) => void): void {
    this.stopInternal(false);
    this.onComplete = onComplete;
    this.active = true;
    this.profile = defaultProfile();
    this.body = null;
    this.idleLevel = 0;
    this.leftX = null;

    this.unsubscribeFrame = this.bus.on('poseFrame', ({ sample, t }) => {
      if (!this.active) return;
      this.onFrame(sample, t);
    });

    this.enter('stand');
  }

  cancel(): void {
    if (!this.active) return;
    this.finish(null);
  }

  private onFrame(sample: PoseSample | null, now: number): void {
    if (this.completeUntil !== null) {
      if (now < this.completeUntil) {
        this.emit('Nice!', this.completeFeedback ?? holdFeedback(1, 1));
        return;
      }
      this.completeUntil = null;
      this.completeFeedback = null;
      this.advance(now);
      return;
    }

    const frame = this.body?.update(sample, now) ?? null;
    switch (this.step) {
      case 'stand':
        this.handleStand(sample, now);
        break;
      case 'lane_left':
      case 'lane_right':
        this.handleLane(sample, now);
        break;
      case 'jump':
        this.handleJump(frame, now);
        break;
      case 'duck':
        this.handleDuck(frame, now);
        break;
      case 'run':
        this.handleRun(sample, now);
        break;
      case 'star_jump':
        this.handleStarJump(frame, now);
        break;
      default:
        break;
    }
  }

  private handleStand(sample: PoseSample | null, now: number): void {
    const full =
      sample &&
      sample.hipMidY !== null &&
      sample.footLY !== null &&
      sample.footRY !== null &&
      sample.star !== null;
    if (!full) {
      this.still = [];
      this.stillSince = null;
      this.emit(FEET_HINT, holdFeedback(0, CALIBRATION.STILL_HOLD_MS));
      return;
    }

    const torso = Math.max(0.05, Math.abs(sample.shoulderMidY - sample.hipMidY!));
    this.cadence.update(sample, torso);
    if (this.stillSince === null) this.stillSince = now;
    this.still.push({
      shoulderY: sample.shoulderMidY,
      torso,
      noseY: sample.noseY,
      hipY: sample.hipMidY!,
      floorY: (sample.footLY! + sample.footRY!) * 0.5,
      lane: laneSignal(sample),
      spread: sample.star!.spread,
    });

    const shoulderStd = this.relativeStd((s) => s.shoulderY, (s) => s.torso);
    if (this.still.length >= 8 && shoulderStd > CALIBRATION.STILL_MAX_STD) {
      this.still = [this.still[this.still.length - 1]!];
      this.stillSince = now;
      this.emit(this.instruction(now), holdFeedback(0, CALIBRATION.STILL_HOLD_MS));
      return;
    }

    const span = now - this.stillSince;
    if (span >= CALIBRATION.STILL_HOLD_MS) {
      this.commitStand();
      this.complete(holdFeedback(1, 1), now);
      return;
    }
    this.emit(this.instruction(now), holdFeedback(span, CALIBRATION.STILL_HOLD_MS));
  }

  private commitStand(): void {
    const mean = (f: (s: StillSample) => number) =>
      this.still.reduce((sum, s) => sum + f(s), 0) / this.still.length;
    const floorY = mean((s) => s.floorY);
    const hipY = mean((s) => s.hipY);
    const legLength = Math.max(0.05, floorY - hipY);
    const ankleStd = this.relativeStd((s) => s.floorY, () => legLength);

    this.profile.baseline = {
      shoulderY: mean((s) => s.shoulderY),
      torsoHeight: Math.max(0.05, mean((s) => s.torso)),
      noseY: mean((s) => s.noseY),
      hipY,
      floorY,
      legLength,
      ankleNoise: ankleStd,
      footSpread: mean((s) => s.spread),
    };
    this.profile.lanes.centerX = mean((s) => s.lane);
    this.idleLevel = this.cadence.value;

    // Floors low enough that real attempts register while their size is measured.
    this.profile.thresholds.airLift = this.airLiftFloor();
    this.profile.thresholds.hipJump = BODY.HIP_JUMP_MIN;
    this.profile.thresholds.crouch = BODY.CROUCH_MIN;
    this.profile.thresholds.starArm = BODY.STAR_ARM_MIN;
    this.profile.thresholds.starSpread = this.starSpreadFloor();
    this.body = new BodyState(this.profile);
  }

  private handleLane(sample: PoseSample | null, now: number): void {
    if (!sample) {
      this.resetLaneHold();
      this.emit(FEET_HINT, holdFeedback(0, CALIBRATION.LANE_HOLD_MS));
      return;
    }

    const centerX = this.profile.lanes.centerX;
    const signal = laneSignal(sample);
    const fromCenter = signal - centerX;
    const separated = Math.abs(fromCenter) >= CALIBRATION.MIN_LANE_SEPARATION;
    const sideOk =
      this.step === 'lane_left' ||
      (this.leftX !== null && fromCenter * (this.leftX - centerX) < 0);

    if (!separated || !sideOk) {
      this.resetLaneHold();
      this.emit(this.instruction(now), holdFeedback(0, CALIBRATION.LANE_HOLD_MS));
      return;
    }

    if (this.holdAnchor === null || Math.abs(signal - this.holdAnchor) > CALIBRATION.LANE_STEADY) {
      this.holdAnchor = signal;
      this.holdStartedAt = now;
      this.holdSum = signal;
      this.holdCount = 1;
      this.emit(this.instruction(now), holdFeedback(0, CALIBRATION.LANE_HOLD_MS));
      return;
    }

    this.holdSum += signal;
    this.holdCount += 1;
    const span = now - (this.holdStartedAt ?? now);
    if (span >= CALIBRATION.LANE_HOLD_MS) {
      const avg = this.holdSum / this.holdCount;
      if (this.step === 'lane_left') {
        this.leftX = avg;
        this.profile.lanes.leftX = avg;
      } else {
        this.profile.lanes.rightX = avg;
      }
      this.complete(holdFeedback(1, 1), now);
      return;
    }
    this.emit(this.instruction(now), holdFeedback(span, CALIBRATION.LANE_HOLD_MS));
  }

  /**
   * A rep is one time in the air, from the feet cue or the hip cue. Foot lift
   * sets airLift; hip rise sets hipJump. A hip-only rep still counts.
   */
  private handleJump(frame: BodyFrame | null, now: number): void {
    const target = CALIBRATION.GESTURE_REPS;
    if (!frame?.valid) {
      this.emit(FEET_HINT, repFeedback(this.jumpReps.length, target));
      return;
    }
    const air = frame.airPhase;
    if (air && (air.peakLift >= CALIBRATION.JUMP_REP_MIN_LIFT || air.peakHip >= BODY.HIP_JUMP_MIN)) {
      this.jumpReps.push({ foot: air.peakLift, hip: air.peakHip });
      if (this.jumpReps.length >= target) {
        const footPeaks = this.jumpReps
          .map((r) => r.foot)
          .filter((v) => v >= CALIBRATION.JUMP_REP_MIN_LIFT);
        const partial: Partial<PoseProfile['thresholds']> = {
          hipJump: Math.max(
            BODY.HIP_JUMP_MIN,
            CALIBRATION.HIP_FROM_REP * Math.min(...this.jumpReps.map((r) => r.hip)),
          ),
        };
        if (footPeaks.length > 0) {
          partial.airLift = clamp(
            CALIBRATION.AIR_FROM_REP * Math.min(...footPeaks),
            this.airLiftFloor(),
            BODY.AIR_LIFT_MAX,
          );
        }
        this.setThreshold(partial);
        this.complete(repFeedback(target, target), now);
        return;
      }
    }
    this.emit(this.instruction(now), repFeedback(this.jumpReps.length, target));
  }

  /** A rep is a crouch held long enough that a jump wind-up cannot count. */
  private handleDuck(frame: BodyFrame | null, now: number): void {
    const target = CALIBRATION.GESTURE_REPS;
    if (!frame?.valid) {
      this.emit(FEET_HINT, repFeedback(this.repValues.length, target));
      return;
    }
    const crouch = frame.crouchPhase;
    if (
      crouch &&
      crouch.durationMs >= CALIBRATION.DUCK_HOLD_MS &&
      crouch.peakDepth >= CALIBRATION.DUCK_REP_MIN_DEPTH
    ) {
      this.repValues.push(crouch.peakDepth);
      if (this.repValues.length >= target) {
        const depth = clamp(
          CALIBRATION.CROUCH_FROM_REP * Math.min(...this.repValues),
          BODY.CROUCH_MIN,
          BODY.CROUCH_MAX,
        );
        this.setThreshold({ crouch: depth });
        this.complete(repFeedback(target, target), now);
        return;
      }
    }
    this.emit(this.instruction(now), repFeedback(this.repValues.length, target));
  }

  private handleRun(sample: PoseSample | null, now: number): void {
    const legsVisible = !!sample && (sample.ankleMidY !== null || sample.kneeMidY !== null);
    if (!sample || !legsVisible) {
      this.resetRunHold();
      this.emit(FEET_HINT, holdFeedback(0, CALIBRATION.RUN_CAPTURE_MS));
      return;
    }

    const level = this.cadence.update(sample, this.profile.baseline.torsoHeight);
    const idle = Math.max(this.idleLevel, 0.004);
    const gate = idle * CALIBRATION.RUN_IDLE_FACTOR;
    if (level > gate) {
      this.runBelowSince = null;
      if (this.runHoldStart === null) this.runHoldStart = now;
      this.runSamples.push(level);
      const span = now - this.runHoldStart;
      if (span >= CALIBRATION.RUN_CAPTURE_MS) {
        const low = percentile(this.runSamples, 0.2);
        if (low > idle) {
          this.setThreshold({ runCadence: (idle + low) / 2 });
          this.complete(holdFeedback(1, 1), now);
          return;
        }
        this.resetRunHold();
        this.emit(this.instruction(now), holdFeedback(0, CALIBRATION.RUN_CAPTURE_MS));
        return;
      }
      this.emit(this.instruction(now), holdFeedback(span, CALIBRATION.RUN_CAPTURE_MS));
      return;
    }

    // A stride pauses between steps. Don't wipe the bar for that gap.
    if (this.runHoldStart !== null) {
      if (this.runBelowSince === null) this.runBelowSince = now;
      const span = now - this.runHoldStart;
      if (now - this.runBelowSince < CALIBRATION.RUN_GAP_MS) {
        this.emit(this.instruction(now), holdFeedback(span, CALIBRATION.RUN_CAPTURE_MS));
        return;
      }
    }

    this.resetRunHold();
    this.emit(this.instruction(now), holdFeedback(0, CALIBRATION.RUN_CAPTURE_MS));
  }

  /**
   * A rep is one jump with a star shape that clears the fixed minimums on enough
   * frames. Thresholds land between the minimums and your weakest rep, so both
   * reps would clear them in a run.
   */
  private handleStarJump(frame: BodyFrame | null, now: number): void {
    const target = CALIBRATION.GESTURE_REPS;
    if (!frame?.valid) {
      this.emit(FEET_HINT, repFeedback(this.starReps.length, target));
      return;
    }
    const air = frame.airPhase;
    if (air && air.starFrames >= BODY.STAR_JUMP_FRAMES && air.starBest) {
      const best = air.starBest;
      this.starReps.push({ arm: Math.min(best.armL, best.armR), spread: best.spread });
      if (this.starReps.length >= target) {
        const minArm = Math.min(...this.starReps.map((r) => r.arm));
        const minSpread = Math.min(...this.starReps.map((r) => r.spread));
        this.setThreshold({
          starArm: Math.max(BODY.STAR_ARM_MIN, CALIBRATION.STAR_ARM_FROM_REP * minArm),
          starSpread: Math.max(this.starSpreadFloor(), CALIBRATION.STAR_SPREAD_FROM_REP * minSpread),
        });
        this.complete(repFeedback(target, target), now);
        return;
      }
    }
    this.emit(this.instruction(now), repFeedback(this.starReps.length, target));
  }

  private airLiftFloor(): number {
    return Math.max(
      BODY.AIR_LIFT_MIN,
      this.profile.baseline.ankleNoise * CALIBRATION.NOISE_MULTIPLIER,
    );
  }

  private starSpreadFloor(): number {
    return Math.max(
      BODY.STAR_SPREAD_MIN,
      this.profile.baseline.footSpread * CALIBRATION.STAR_SPREAD_OVER_STANDING,
    );
  }

  private setThreshold(partial: Partial<PoseProfile['thresholds']>): void {
    this.profile.thresholds = { ...this.profile.thresholds, ...partial };
    this.body?.setThresholds(partial);
  }

  private relativeStd(
    value: (s: StillSample) => number,
    scale: (s: StillSample) => number,
  ): number {
    const n = this.still.length;
    if (n < 2) return 0;
    const mean = this.still.reduce((sum, s) => sum + value(s), 0) / n;
    const variance = this.still.reduce((sum, s) => sum + (value(s) - mean) ** 2, 0) / n;
    const meanScale = this.still.reduce((sum, s) => sum + scale(s), 0) / n;
    return Math.sqrt(variance) / Math.max(0.05, meanScale);
  }

  private instruction(now: number): string {
    if (now - this.stepStartedAt >= CALIBRATION.HINT_AFTER_MS) return this.hint();
    return this.prompt();
  }

  private prompt(): string {
    switch (this.step) {
      case 'stand':
        return 'Stand still in the middle';
      case 'lane_left':
        return 'Step to your left';
      case 'lane_right':
        return 'Step to your right';
      case 'jump':
        return 'Back to the middle, jump twice';
      case 'duck':
        return 'Duck down and hold, twice';
      case 'run':
        return 'Run in place';
      case 'star_jump':
        return 'Star jump twice — arms up and out, feet wide';
      default:
        return 'Calibration complete';
    }
  }

  private hint(): string {
    switch (this.step) {
      case 'stand':
        return 'Hold still';
      case 'lane_left':
        return 'Step farther to your left';
      case 'lane_right':
        return 'Step farther to your right';
      case 'jump':
        return 'Jump higher — both feet off the floor';
      case 'duck':
        return 'Crouch lower and hold it';
      case 'run':
        return 'Move your feet faster';
      case 'star_jump':
        return 'Jump higher, arms above shoulders, feet wider';
      default:
        return 'Calibration complete';
    }
  }

  private resetLaneHold(): void {
    this.holdStartedAt = null;
    this.holdAnchor = null;
    this.holdSum = 0;
    this.holdCount = 0;
  }

  private resetRunHold(): void {
    this.runHoldStart = null;
    this.runBelowSince = null;
    this.runSamples = [];
  }

  private resetStepState(): void {
    this.still = [];
    this.stillSince = null;
    this.resetLaneHold();
    this.repValues = [];
    this.jumpReps = [];
    this.starReps = [];
    this.resetRunHold();
  }

  /** `now` is on the poseFrame timeline, which the hint timer compares against. */
  private enter(step: CalibrationStepId, now = performance.now()): void {
    this.step = step;
    this.stepStartedAt = now;
    this.resetStepState();
    if (step === 'stand' || step === 'run') this.cadence.reset();
    const feedback =
      step === 'jump' || step === 'duck' || step === 'star_jump'
        ? repFeedback(0, CALIBRATION.GESTURE_REPS)
        : holdFeedback(0, 1);
    this.emit(this.prompt(), feedback);
  }

  /** Show the finished step (full bar or all dots) briefly, then move on. */
  private complete(feedback: CalibrationFeedback, now: number): void {
    this.completeUntil = now + CALIBRATION.SUCCESS_BEAT_MS;
    this.completeFeedback = feedback;
    this.emit('Nice!', feedback);
  }

  private advance(now: number): void {
    const index = STEPS.indexOf(this.step);
    const next = STEPS[index + 1];
    if (!next) {
      this.finish(this.buildProfile());
      return;
    }
    this.enter(next, now);
  }

  private buildProfile(): PoseProfile {
    return {
      ...this.profile,
      version: CALIBRATION.PROFILE_VERSION,
      baseline: { ...this.profile.baseline },
      thresholds: {
        ...this.profile.thresholds,
        runCadence: this.profile.thresholds.runCadence || VISION.RUN_CADENCE_RATIO,
      },
      lanes: { ...this.profile.lanes },
      createdAt: Date.now(),
    };
  }

  private emit(instruction: string, feedback: CalibrationFeedback): void {
    const stepIndex = this.step === 'done' ? STEPS.length : Math.max(0, STEPS.indexOf(this.step));
    const update: CalibrationUpdate = {
      step: this.step,
      stepIndex,
      stepTotal: STEPS.length,
      instruction,
      feedback,
    };
    this.bus.emit('calibration', update);
  }

  private finish(profile: PoseProfile | null): void {
    const cb = this.onComplete;
    this.stopInternal(true);
    if (profile) {
      this.step = 'done';
      this.emit('Calibration complete', holdFeedback(1, 1));
    }
    cb?.(profile);
  }

  private stopInternal(clearCallbacks: boolean): void {
    this.active = false;
    this.completeUntil = null;
    this.completeFeedback = null;
    this.unsubscribeFrame?.();
    this.unsubscribeFrame = null;
    if (clearCallbacks) this.onComplete = null;
  }
}

function holdFeedback(value: number, target: number): CalibrationFeedback {
  return { kind: 'hold', value: Math.max(0, value), target };
}

function repFeedback(value: number, target: number): CalibrationFeedback {
  return { kind: 'reps', value, target };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[index]!;
}
