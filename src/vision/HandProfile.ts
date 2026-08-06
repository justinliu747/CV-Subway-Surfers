import { HAND_UI } from '../config/GameConfig';
import type { HandCorners, Handedness, Vec2 } from '../core/types';

export interface HandProfile {
  version: number;
  corners: HandCorners;
  handedness: Handedness;
  /** Scale-normalized tipDistance/handScale thresholds. */
  pinchClose: number;
  pinchOpen: number;
  createdAt: number;
}

export function defaultHandCorners(): HandCorners {
  return {
    tl: { x: 0.2, y: 0.2 },
    tr: { x: 0.8, y: 0.2 },
    br: { x: 0.8, y: 0.8 },
    bl: { x: 0.2, y: 0.8 },
  };
}

/** Convert raw MediaPipe image X into mirrored display space if configured. */
export function toDisplayPoint(raw: Vec2): Vec2 {
  return {
    x: HAND_UI.MIRROR_X ? 1 - raw.x : raw.x,
    y: raw.y,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidVec2(value: unknown): value is Vec2 {
  if (!value || typeof value !== 'object') return false;
  const v = value as Vec2;
  return isFiniteNumber(v.x) && isFiniteNumber(v.y);
}

function isValidHandedness(value: unknown): value is Handedness {
  return value === 'Left' || value === 'Right';
}

function isValidProfile(value: unknown): value is HandProfile {
  if (!value || typeof value !== 'object') return false;
  const p = value as HandProfile;
  if (p.version !== HAND_UI.PROFILE_VERSION) return false;
  if (!isFiniteNumber(p.createdAt) || !p.corners) return false;
  if (!isValidHandedness(p.handedness)) return false;
  if (!isFiniteNumber(p.pinchClose) || !isFiniteNumber(p.pinchOpen)) return false;
  if (!(p.pinchOpen > p.pinchClose)) return false;
  return (
    isValidVec2(p.corners.tl) &&
    isValidVec2(p.corners.tr) &&
    isValidVec2(p.corners.br) &&
    isValidVec2(p.corners.bl)
  );
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

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/** Signed area of the quad via two triangles (TL-TR-BR + TL-BR-BL). */
export function quadArea(corners: HandCorners): number {
  const { tl, tr, br, bl } = corners;
  const a1 = Math.abs(cross(tr.x - tl.x, tr.y - tl.y, br.x - tl.x, br.y - tl.y)) * 0.5;
  const a2 = Math.abs(cross(br.x - tl.x, br.y - tl.y, bl.x - tl.x, bl.y - tl.y)) * 0.5;
  return a1 + a2;
}

/** True if adjacent edges cross (self-intersecting bowtie). */
export function isQuadCrossed(corners: HandCorners): boolean {
  const { tl, tr, br, bl } = corners;
  return segmentsIntersect(tl, tr, br, bl) || segmentsIntersect(tr, br, bl, tl);
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y);
  const d2 = cross(b.x - a.x, b.y - a.y, d.x - a.x, d.y - a.y);
  const d3 = cross(d.x - c.x, d.y - c.y, a.x - c.x, a.y - c.y);
  const d4 = cross(d.x - c.x, d.y - c.y, b.x - c.x, b.y - c.y);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function validateHandCorners(corners: HandCorners): string | null {
  if (isQuadCrossed(corners)) {
    return 'Corners form a crossed shape. Spread them out and try again.';
  }
  if (quadArea(corners) < HAND_UI.MIN_QUAD_AREA) {
    return 'Interaction area is too small. Spread the corners farther apart.';
  }
  return null;
}

/**
 * Inverse bilinear map: point in display/camera space → UV in the calibrated quad.
 * Uses Newton iteration on P = (1-u)(1-v)TL + u(1-v)TR + u v BR + (1-u)v BL.
 */
export function pointToUv(point: Vec2, corners: HandCorners): Vec2 {
  const { tl: A, tr: B, br: C, bl: D } = corners;
  let u = 0.5;
  let v = 0.5;

  for (let i = 0; i < 8; i++) {
    const px = (1 - u) * (1 - v) * A.x + u * (1 - v) * B.x + u * v * C.x + (1 - u) * v * D.x;
    const py = (1 - u) * (1 - v) * A.y + u * (1 - v) * B.y + u * v * C.y + (1 - u) * v * D.y;
    const ex = px - point.x;
    const ey = py - point.y;

    const dxdu = (1 - v) * (B.x - A.x) + v * (C.x - D.x);
    const dydu = (1 - v) * (B.y - A.y) + v * (C.y - D.y);
    const dxdv = (1 - u) * (D.x - A.x) + u * (C.x - B.x);
    const dydv = (1 - u) * (D.y - A.y) + u * (C.y - B.y);
    const det = dxdu * dydv - dxdv * dydu;
    if (Math.abs(det) < 1e-12) break;

    u -= (ex * dydv - ey * dxdv) / det;
    v -= (dxdu * ey - dydu * ex) / det;
  }

  return { x: u, y: v };
}

/** Map calibrated UV to screen CSS pixels. */
export function uvToScreen(uv: Vec2, width = window.innerWidth, height = window.innerHeight): Vec2 {
  return {
    x: uv.x * width,
    y: uv.y * height,
  };
}

export function averagePoints(points: Vec2[]): Vec2 {
  if (points.length === 0) return { x: 0.5, y: 0.5 };
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

export function parseHandedness(raw: string | undefined | null): Handedness | null {
  if (raw === 'Left' || raw === 'Right') return raw;
  return null;
}
