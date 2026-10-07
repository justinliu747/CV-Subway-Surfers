/**
 * Laptop stands with the screen on the user's left and the keyboard on the right.
 * Rotate the sensor 90° clockwise so the person is upright in the preview and
 * in pose/hand tracking. The other direction leaves them upside down.
 */
export function drawUpright(video: HTMLVideoElement, dest: HTMLCanvasElement): boolean {
  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  if (!srcW || !srcH) return false;

  if (dest.width !== srcH || dest.height !== srcW) {
    dest.width = srcH;
    dest.height = srcW;
  }

  const ctx = dest.getContext('2d');
  if (!ctx) return false;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, dest.width, dest.height);
  ctx.translate(dest.width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(video, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return true;
}

const fallback = document.createElement('canvas');
let lastKey: number | null = null;
let lastTarget: HTMLCanvasElement | null = null;

/**
 * The upright frame, drawn once per video frame into the preview canvas and
 * shared by the preview, pose tracking, and hand tracking.
 */
export function uprightFrame(video: HTMLVideoElement, frameKey: number): HTMLCanvasElement | null {
  const preview = document.getElementById('preview');
  const target = preview instanceof HTMLCanvasElement ? preview : fallback;
  if (frameKey === lastKey && target === lastTarget) return target;
  if (!drawUpright(video, target)) return null;
  lastKey = frameKey;
  lastTarget = target;
  return target;
}

/** The most recent upright frame, as last drawn by the pose tracker. */
export function currentUprightFrame(): HTMLCanvasElement | null {
  return lastTarget && lastTarget.width > 0 ? lastTarget : null;
}
