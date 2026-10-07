import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { HAND_UI, VISION } from '../config/GameConfig';
import type { Handedness, PoseLandmarkPoint } from '../core/types';
import { detectHandInCrop } from './handDetect';

type InMessage =
  | { type: 'init'; wasmBase: string; modelUrl: string }
  | { type: 'frame'; bitmap: ImageBitmap; ts: number; hand: Handedness | null };

const scope = self as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<InMessage>) => void) | null;
};

let landmarker: PoseLandmarker | null = null;
let handLandmarker: HandLandmarker | null = null;
let handPromise: Promise<HandLandmarker | null> | null = null;
let fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null = null;
const crop = new OffscreenCanvas(HAND_UI.CROP_SIZE, HAND_UI.CROP_SIZE);

async function init(wasmBase: string, modelUrl: string): Promise<string> {
  // `true` loads the ES-module Wasm loader, which module workers require.
  fileset = await FilesetResolver.forVisionTasks(wasmBase, true);
  let lastError: unknown = null;
  for (const delegate of ['GPU', 'CPU'] as const) {
    try {
      landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelUrl, delegate },
        canvas: delegate === 'GPU' ? new OffscreenCanvas(1, 1) : undefined,
        runningMode: 'VIDEO',
        numPoses: 1,
      });
      return delegate;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/** First request only. Later frames reuse the model. A failed load stays failed. */
function ensureHand(): Promise<HandLandmarker | null> {
  if (handLandmarker) return Promise.resolve(handLandmarker);
  if (handPromise) return handPromise;
  const vision = fileset;
  if (!vision) return Promise.resolve(null);
  handPromise = (async () => {
    let lastError: unknown = null;
    for (const delegate of ['GPU', 'CPU'] as const) {
      try {
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: VISION.HAND_MODEL_URL, delegate },
          canvas: delegate === 'GPU' ? new OffscreenCanvas(1, 1) : undefined,
          runningMode: 'VIDEO',
          numHands: 1,
        });
        return handLandmarker;
      } catch (error) {
        lastError = error;
      }
    }
    console.warn('[hands] worker model failed:', lastError);
    return null;
  })();
  return handPromise;
}

function plain(points: Array<{ x: number; y: number; z: number; visibility?: number }>): PoseLandmarkPoint[] {
  return points.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility }));
}

scope.onmessage = (event) => {
  void handle(event.data);
};

async function handle(msg: InMessage): Promise<void> {
  if (msg.type === 'init') {
    init(msg.wasmBase, msg.modelUrl)
      .then((delegate) => scope.postMessage({ type: 'ready', delegate }))
      .catch((error: unknown) => scope.postMessage({ type: 'error', message: String(error) }));
    return;
  }

  if (!landmarker) {
    msg.bitmap.close();
    scope.postMessage({
      type: 'result',
      ts: msg.ts,
      landmarks: null,
      world: null,
      inferenceMs: 0,
      hand: null,
      handMs: 0,
    });
    return;
  }

  const started = performance.now();
  try {
    const result = landmarker.detectForVideo(msg.bitmap, msg.ts);
    const poseMs = performance.now() - started;
    const pose = result.landmarks[0];
    const world = result.worldLandmarks[0];
    const landmarks = pose ? plain(pose) : null;
    let hand: PoseLandmarkPoint[] | null = null;
    let handMs = 0;
    if (msg.hand && landmarks) {
      const marker = await ensureHand();
      if (marker) {
        const detected = detectHandInCrop(
          marker,
          msg.bitmap,
          msg.bitmap.width,
          msg.bitmap.height,
          landmarks,
          msg.hand,
          msg.ts,
          crop,
        );
        hand = detected.landmarks;
        handMs = detected.ms;
      }
    }
    scope.postMessage({
      type: 'result',
      ts: msg.ts,
      landmarks,
      world: world ? plain(world) : null,
      inferenceMs: poseMs,
      hand,
      handMs,
    });
  } catch (error) {
    scope.postMessage({
      type: 'result',
      ts: msg.ts,
      landmarks: null,
      world: null,
      inferenceMs: performance.now() - started,
      hand: null,
      handMs: 0,
      error: String(error),
    });
  } finally {
    msg.bitmap.close();
  }
}
