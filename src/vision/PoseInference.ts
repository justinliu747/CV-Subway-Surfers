import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import { HAND_UI, VISION } from '../config/GameConfig';
import type { Handedness, PoseLandmarkPoint } from '../core/types';
import { detectHandInCrop } from './handDetect';

export interface PoseResult {
  landmarks: PoseLandmarkPoint[] | null;
  world: PoseLandmarkPoint[] | null;
  inferenceMs: number;
  /** Hand landmarks for the requested side, from the same frame. Null when hands are off. */
  hand: PoseLandmarkPoint[] | null;
  handMs: number;
}

export interface PoseInference {
  readonly mode: 'worker' | 'main';
  readonly delegate: string;
  readonly model: string;
  detect(frame: HTMLCanvasElement, ts: number, hand: Handedness | null): Promise<PoseResult>;
  close(): void;
}

const EMPTY: PoseResult = { landmarks: null, world: null, inferenceMs: 0, hand: null, handMs: 0 };

/** `?model=full` picks the full model; `?mainthread` skips the worker. */
export function selectedModel(): { name: string; url: string } {
  const params = new URLSearchParams(window.location.search);
  return params.get('model') === 'full'
    ? { name: 'full', url: VISION.MODEL_URL_FULL }
    : { name: 'lite', url: VISION.MODEL_URL };
}

/** Worker first, so inference stops blocking rendering; main thread if that fails. */
export async function createPoseInference(): Promise<PoseInference> {
  const model = selectedModel();
  const forceMain = new URLSearchParams(window.location.search).has('mainthread');
  if (!forceMain && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
    try {
      return await WorkerInference.create(model.name, model.url);
    } catch (error) {
      console.warn('[pose] worker inference unavailable, using main thread:', error);
    }
  }
  return MainInference.create(model.name, model.url);
}

class WorkerInference implements PoseInference {
  readonly mode = 'worker' as const;
  readonly delegate: string;
  readonly model: string;
  private readonly worker: Worker;
  private pending: ((result: PoseResult) => void) | null = null;

  private constructor(worker: Worker, delegate: string, model: string) {
    this.worker = worker;
    this.delegate = delegate;
    this.model = model;
    this.worker.onmessage = (event: MessageEvent) => {
      const data = event.data as { type: string } & Partial<PoseResult>;
      if (data.type !== 'result') return;
      const resolve = this.pending;
      this.pending = null;
      resolve?.({
        landmarks: data.landmarks ?? null,
        world: data.world ?? null,
        inferenceMs: data.inferenceMs ?? 0,
        hand: data.hand ?? null,
        handMs: data.handMs ?? 0,
      });
    };
  }

  static async create(model: string, modelUrl: string): Promise<WorkerInference> {
    const worker = new Worker(new URL('./poseWorker.ts', import.meta.url), { type: 'module' });
    try {
      const delegate = await new Promise<string>((resolve, reject) => {
        const timer = window.setTimeout(
          () => reject(new Error('worker init timed out')),
          VISION.WORKER_INIT_TIMEOUT_MS,
        );
        worker.onmessage = (event: MessageEvent) => {
          const data = event.data as { type: string; delegate?: string; message?: string };
          if (data.type === 'ready') {
            window.clearTimeout(timer);
            resolve(data.delegate ?? 'GPU');
          } else if (data.type === 'error') {
            window.clearTimeout(timer);
            reject(new Error(data.message));
          }
        };
        worker.onerror = (event) => {
          window.clearTimeout(timer);
          reject(new Error(event.message || 'worker error'));
        };
        worker.postMessage({ type: 'init', wasmBase: VISION.WASM_BASE, modelUrl });
      });
      worker.onerror = (event) => console.warn('[pose] worker error:', event.message);
      return new WorkerInference(worker, delegate, model);
    } catch (error) {
      worker.terminate();
      throw error;
    }
  }

  async detect(frame: HTMLCanvasElement, ts: number, hand: Handedness | null): Promise<PoseResult> {
    const bitmap = await createImageBitmap(frame);
    return new Promise<PoseResult>((resolve) => {
      this.pending = resolve;
      this.worker.postMessage({ type: 'frame', bitmap, ts, hand }, [bitmap]);
    });
  }

  close(): void {
    this.pending?.(EMPTY);
    this.pending = null;
    this.worker.terminate();
  }
}

class MainInference implements PoseInference {
  readonly mode = 'main' as const;
  readonly delegate = 'GPU';
  readonly model: string;
  private readonly landmarker: PoseLandmarker;
  private readonly fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
  private hand: HandLandmarker | null = null;
  private handPromise: Promise<HandLandmarker | null> | null = null;
  private readonly crop: HTMLCanvasElement;

  private constructor(
    landmarker: PoseLandmarker,
    fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
    model: string,
  ) {
    this.landmarker = landmarker;
    this.fileset = fileset;
    this.model = model;
    this.crop = document.createElement('canvas');
    this.crop.width = HAND_UI.CROP_SIZE;
    this.crop.height = HAND_UI.CROP_SIZE;
  }

  static async create(model: string, modelUrl: string): Promise<MainInference> {
    const fileset = await FilesetResolver.forVisionTasks(VISION.WASM_BASE);
    const landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelUrl, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
    return new MainInference(landmarker, fileset, model);
  }

  /** First request only. Pose results are not delayed by a model the menus are not using. */
  private ensureHand(): Promise<HandLandmarker | null> {
    if (this.hand) return Promise.resolve(this.hand);
    if (this.handPromise) return this.handPromise;
    this.handPromise = HandLandmarker.createFromOptions(this.fileset, {
      baseOptions: { modelAssetPath: VISION.HAND_MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1,
    })
      .then((marker) => {
        this.hand = marker;
        return marker;
      })
      .catch((error: unknown) => {
        console.warn('[hands] main-thread model failed:', error);
        return null;
      });
    return this.handPromise;
  }

  async detect(frame: HTMLCanvasElement, ts: number, hand: Handedness | null): Promise<PoseResult> {
    const started = performance.now();
    const result = this.landmarker.detectForVideo(frame, ts);
    const poseMs = performance.now() - started;
    const pose = result.landmarks[0];
    const world = result.worldLandmarks[0];
    const landmarks = pose ? (pose as PoseLandmarkPoint[]) : null;
    let handPoints: PoseLandmarkPoint[] | null = null;
    let handMs = 0;
    if (hand && landmarks) {
      const marker = await this.ensureHand();
      if (marker) {
        const detected = detectHandInCrop(
          marker,
          frame,
          frame.width,
          frame.height,
          landmarks,
          hand,
          ts,
          this.crop,
        );
        handPoints = detected.landmarks;
        handMs = detected.ms;
      }
    }
    return {
      landmarks,
      world: world ? (world as PoseLandmarkPoint[]) : null,
      inferenceMs: poseMs,
      hand: handPoints,
      handMs,
    };
  }

  close(): void {
    this.hand?.close();
    this.hand = null;
    this.landmarker.close();
  }
}
