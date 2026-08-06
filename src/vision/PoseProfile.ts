import { CALIBRATION, VISION } from '../config/GameConfig';
import type { Lane, PoseSample } from '../core/types';

export interface PoseProfileBaseline {
  shoulderY: number;
  torsoHeight: number;
  shoulderWidth: number;
  noseX: number;
  shoulderMidX: number;
  noiseStdDev: number;
}

export interface PoseProfileThresholds {
  jump: number;
  duck: number;
}

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
      shoulderY: 0.4,
      torsoHeight: 0.25,
      shoulderWidth: 0.2,
      noseX: 0.5,
      shoulderMidX: 0.5,
      noiseStdDev: 0.01,
    },
    thresholds: {
      jump: VISION.JUMP_RATIO,
      duck: VISION.DUCK_RATIO,
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

function isValidProfile(value: unknown): value is PoseProfile {
  if (!value || typeof value !== 'object') return false;
  const p = value as PoseProfile;
  if (p.version !== CALIBRATION.PROFILE_VERSION) return false;
  if (!p.baseline || !p.thresholds || !p.lanes) return false;
  if (!isFiniteNumber(p.createdAt)) return false;

  const b = p.baseline;
  const t = p.thresholds;
  const l = p.lanes;
  return (
    isFiniteNumber(b.shoulderY) &&
    isFiniteNumber(b.torsoHeight) &&
    isFiniteNumber(b.shoulderWidth) &&
    isFiniteNumber(b.noseX) &&
    isFiniteNumber(b.shoulderMidX) &&
    isFiniteNumber(b.noiseStdDev) &&
    isFiniteNumber(t.jump) &&
    isFiniteNumber(t.duck) &&
    isFiniteNumber(l.leftX) &&
    isFiniteNumber(l.centerX) &&
    isFiniteNumber(l.rightX)
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
