import { BODY, CALIBRATION, VISION } from '../config/GameConfig';
import type { BodyThresholds, Lane, PoseSample } from '../core/types';

/** Standing measurements, upright image space (0..1, y grows downward). */
export interface PoseProfileBaseline {
  shoulderY: number;
  torsoHeight: number;
  noseY: number;
  hipY: number;
  /** Mean lowest foot point while standing: the floor line. */
  floorY: number;
  /** floorY − hipY. The unit for every vertical threshold. */
  legLength: number;
  /** Ankle Y stddev while standing, in leg lengths. */
  ankleNoise: number;
  /** Standing ankle distance ÷ hip width. */
  footSpread: number;
}

export type PoseProfileThresholds = BodyThresholds;

export interface PoseProfileLanes {
  leftX: number;
  centerX: number;
  rightX: number;
}

export interface PoseProfile {
  version: number;
  baseline: PoseProfileBaseline;
  thresholds: PoseProfileThresholds;
  lanes: PoseProfileLanes;
  createdAt: number;
}

/** Blended horizontal body signal used for lane classification (image X, 0..1). */
export function laneSignal(sample: PoseSample): number {
  return 0.4 * sample.noseX + 0.6 * sample.shoulderMidX;
}

/**
 * EMA of torso-normalized ankle (or knee) motion.
 * Calibration and gameplay both threshold this value.
 */
export class RunCadence {
  private prevAnkleY: number | null = null;
  private prevKneeY: number | null = null;
  private smoothed = 0;

  reset(): void {
    this.prevAnkleY = null;
    this.prevKneeY = null;
    this.smoothed = 0;
  }

  get value(): number {
    return this.smoothed;
  }

  update(sample: PoseSample, torsoHeight: number): number {
    const torso = Math.max(0.05, torsoHeight);
    let instant = 0;
    if (sample.ankleMidY !== null) {
      if (this.prevAnkleY !== null) {
        instant = Math.abs(sample.ankleMidY - this.prevAnkleY) / torso;
      }
      this.prevAnkleY = sample.ankleMidY;
    } else {
      this.prevAnkleY = null;
    }
    // Facing the camera, ankles barely change height. The knee lift does.
    if (sample.kneeMidY !== null) {
      if (this.prevKneeY !== null) {
        const knee = Math.abs(sample.kneeMidY - this.prevKneeY) / torso;
        if (knee > instant) instant = knee;
      }
      this.prevKneeY = sample.kneeMidY;
    } else {
      this.prevKneeY = null;
    }

    const alpha = VISION.RUN_SMOOTHING;
    this.smoothed = alpha * instant + (1 - alpha) * this.smoothed;
    return this.smoothed;
  }
}

/** Classify a lane signal against calibrated left/center/right references. */
export function classifyLane(signal: number, lanes: PoseProfileLanes): Lane {
  const dLeft = Math.abs(signal - lanes.leftX);
  const dCenter = Math.abs(signal - lanes.centerX);
  const dRight = Math.abs(signal - lanes.rightX);

  if (dLeft <= dCenter && dLeft <= dRight) return -1;
  if (dRight <= dCenter && dRight <= dLeft) return 1;
  return 0;
}

export function defaultProfile(): PoseProfile {
  return {
    version: CALIBRATION.PROFILE_VERSION,
    baseline: {
      shoulderY: 0.3,
      torsoHeight: 0.2,
      noseY: 0.2,
      hipY: 0.5,
      floorY: 0.92,
      legLength: 0.42,
      ankleNoise: 0.005,
      footSpread: 1.2,
    },
    thresholds: {
      airLift: BODY.AIR_LIFT_DEFAULT,
      hipJump: BODY.HIP_JUMP_DEFAULT,
      crouch: BODY.CROUCH_DEFAULT,
      runCadence: VISION.RUN_CADENCE_RATIO,
      starArm: BODY.STAR_ARM_DEFAULT,
      starSpread: BODY.STAR_SPREAD_DEFAULT,
    },
    lanes: {
      // Front-camera image space: physical left ≈ high X (selfie preview is CSS-mirrored).
      leftX: 5 / 6,
      centerX: 0.5,
      rightX: 1 / 6,
    },
    createdAt: Date.now(),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function allFinite(obj: object, keys: string[]): boolean {
  const record = obj as Record<string, unknown>;
  return keys.every((k) => isFiniteNumber(record[k]));
}

function isValidProfile(value: unknown): value is PoseProfile {
  if (!value || typeof value !== 'object') return false;
  const p = value as PoseProfile;
  if (p.version !== CALIBRATION.PROFILE_VERSION) return false;
  if (!p.baseline || !p.thresholds || !p.lanes) return false;
  if (!isFiniteNumber(p.createdAt)) return false;
  return (
    allFinite(p.baseline, [
      'shoulderY',
      'torsoHeight',
      'noseY',
      'hipY',
      'floorY',
      'legLength',
      'ankleNoise',
      'footSpread',
    ]) &&
    allFinite(p.thresholds, ['airLift', 'hipJump', 'crouch', 'runCadence', 'starArm', 'starSpread']) &&
    allFinite(p.lanes, ['leftX', 'centerX', 'rightX']) &&
    p.baseline.legLength > 0
  );
}

export function loadProfile(): PoseProfile | null {
  try {
    const raw = localStorage.getItem(CALIBRATION.PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidProfile(parsed)) {
      clearProfile();
      return null;
    }
    return parsed;
  } catch {
    clearProfile();
    return null;
  }
}

export function saveProfile(profile: PoseProfile): void {
  const toSave: PoseProfile = {
    ...profile,
    version: CALIBRATION.PROFILE_VERSION,
  };
  localStorage.setItem(CALIBRATION.PROFILE_STORAGE_KEY, JSON.stringify(toSave));
}

export function clearProfile(): void {
  localStorage.removeItem(CALIBRATION.PROFILE_STORAGE_KEY);
}

export function hasSavedProfile(): boolean {
  return loadProfile() !== null;
}
