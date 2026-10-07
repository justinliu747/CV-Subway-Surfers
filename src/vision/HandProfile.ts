import { HAND_UI } from '../config/GameConfig';
import type { Handedness, Vec2 } from '../core/types';

export interface HandProfile {
  version: number;
  /** The player's own hand that drives the menu cursor. */
  handedness: Handedness;
  /** Pinch ratio thresholds (tip distance ÷ wrist→middle-knuckle). */
  pinchClose: number;
  pinchOpen: number;
  createdAt: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidProfile(value: unknown): value is HandProfile {
  if (!value || typeof value !== 'object') return false;
  const p = value as HandProfile;
  if (p.version !== HAND_UI.PROFILE_VERSION) return false;
  if (p.handedness !== 'Left' && p.handedness !== 'Right') return false;
  if (!isFiniteNumber(p.createdAt)) return false;
  if (!isFiniteNumber(p.pinchClose) || !isFiniteNumber(p.pinchOpen)) return false;
  return p.pinchOpen > p.pinchClose;
}

export function loadHandProfile(): HandProfile | null {
  try {
    const raw = localStorage.getItem(HAND_UI.PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidProfile(parsed)) {
      clearHandProfile();
      return null;
    }
    return parsed;
  } catch {
    clearHandProfile();
    return null;
  }
}

export function saveHandProfile(profile: HandProfile): void {
  const toSave: HandProfile = {
    ...profile,
    version: HAND_UI.PROFILE_VERSION,
  };
  localStorage.setItem(HAND_UI.PROFILE_STORAGE_KEY, JSON.stringify(toSave));
}

export function clearHandProfile(): void {
  localStorage.removeItem(HAND_UI.PROFILE_STORAGE_KEY);
}

export function hasHandProfile(): boolean {
  return loadHandProfile() !== null;
}

/** Map pointing-area UV to pixels inside the portrait #app layout. */
export function uvToScreen(uv: Vec2): Vec2 {
  const app = document.getElementById('app');
  const width = app?.clientWidth || window.innerWidth;
  const height = app?.clientHeight || window.innerHeight;
  return {
    x: uv.x * width,
    y: uv.y * height,
  };
}
