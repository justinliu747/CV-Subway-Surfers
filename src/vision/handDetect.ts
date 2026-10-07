import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { HAND_UI, LANDMARK, VISION } from '../config/GameConfig';
import type { Handedness, PoseLandmarkPoint } from '../core/types';

const ARM: Record<Handedness, { shoulder: number; elbow: number; wrist: number }> = {
  Left: { shoulder: LANDMARK.L_SHOULDER, elbow: LANDMARK.L_ELBOW, wrist: LANDMARK.L_WRIST },
  Right: { shoulder: LANDMARK.R_SHOULDER, elbow: LANDMARK.R_ELBOW, wrist: LANDMARK.R_WRIST },
};

type CropCanvas = HTMLCanvasElement | OffscreenCanvas;

/**
 * Wrist crop and hand-model call shared by the pose worker and the main-thread
 * fallback. The crop is taken from the same frame pose just ran on.
 */
export function detectHandInCrop(
  landmarker: HandLandmarker,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  pose: PoseLandmarkPoint[],
  side: Handedness,
  ts: number,
  crop: CropCanvas,
): { landmarks: PoseLandmarkPoint[] | null; ms: number } {
  const started = performance.now();
  const ctx = crop.getContext('2d');
  if (!ctx) return { landmarks: null, ms: 0 };

  const px = (i: number): { x: number; y: number } | null => {
    const p = pose[i];
    if (!p || (p.visibility ?? 0) < VISION.MIN_VISIBILITY) return null;
    return { x: p.x * sourceWidth, y: p.y * sourceHeight };
  };

  const lShoulder = px(LANDMARK.L_SHOULDER);
  const rShoulder = px(LANDMARK.R_SHOULDER);
  const wrist = px(ARM[side].wrist);
  const elbow = px(ARM[side].elbow);
  if (!lShoulder || !rShoulder || !wrist) return { landmarks: null, ms: performance.now() - started };

  const sw = Math.max(10, Math.hypot(lShoulder.x - rShoulder.x, lShoulder.y - rShoulder.y));
  const dir = elbow ? { x: wrist.x - elbow.x, y: wrist.y - elbow.y } : { x: 0, y: -sw * 0.5 };
  const cx = wrist.x + dir.x * HAND_UI.CROP_REACH;
  const cy = wrist.y + dir.y * HAND_UI.CROP_REACH;
  const sidePx = sw * HAND_UI.CROP_SCALE;

  ctx.clearRect(0, 0, crop.width, crop.height);
  ctx.drawImage(
    source,
    cx - sidePx / 2,
    cy - sidePx / 2,
    sidePx,
    sidePx,
    0,
    0,
    crop.width,
    crop.height,
  );

  try {
    const result = landmarker.detectForVideo(crop, ts);
    const hand = result.landmarks[0];
    return {
      landmarks: hand
        ? hand.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility }))
        : null,
      ms: performance.now() - started,
    };
  } catch (error) {
    console.warn('[hands] detectForVideo failed:', error);
    return { landmarks: null, ms: performance.now() - started };
  }
}
