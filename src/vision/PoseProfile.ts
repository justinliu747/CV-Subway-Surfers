import { CALIBRATION, VISION } from '../config/GameConfig';

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
  laneLeft: number;
  laneRight: number;
}

export interface PoseProfile {
  version: number;
  baseline: PoseProfileBaseline;
  thresholds: PoseProfileThresholds;
  mirror: boolean;
  createdAt: number;
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
      laneLeft: VISION.LANE_RATIO,
      laneRight: VISION.LANE_RATIO,
    },
    mirror: VISION.MIRROR,
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
  if (!p.baseline || !p.thresholds) return false;
  if (typeof p.mirror !== 'boolean' || !isFiniteNumber(p.createdAt)) return false;

  const b = p.baseline;
  const t = p.thresholds;
  return (
    isFiniteNumber(b.shoulderY) &&
    isFiniteNumber(b.torsoHeight) &&
    isFiniteNumber(b.shoulderWidth) &&
    isFiniteNumber(b.noseX) &&
    isFiniteNumber(b.shoulderMidX) &&
    isFiniteNumber(b.noiseStdDev) &&
    isFiniteNumber(t.jump) &&
    isFiniteNumber(t.duck) &&
    isFiniteNumber(t.laneLeft) &&
    isFiniteNumber(t.laneRight)
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
