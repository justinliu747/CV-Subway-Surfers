import type { EventBus } from '../core/EventBus';
import type { BodyFrame, GameEvents, Handedness, IGestureSource } from '../core/types';
import { BodyState, crouchDepth01 } from './BodyState';
import { createPoseInference, type PoseInference, type PoseResult } from './PoseInference';
import { readSample } from './PoseFeatures';
import { defaultProfile, type PoseProfile } from './PoseProfile';
import { uprightFrame } from './uprightFrame';

export class PoseTracker implements IGestureSource {
  readonly name = 'pose' as const;

  private readonly video: HTMLVideoElement;
  private readonly bus: EventBus<GameEvents>;
  private inference: PoseInference | null = null;
  private running = false;
  private detectionEnabled = false;
  private profile: PoseProfile = defaultProfile();
  private readonly body = new BodyState(this.profile);
  private rafHandle = 0;
  private rvfcHandle = 0;
  private lastTimestampMs = -1;
  private busy = false;

  private readonly cameraTimes: number[] = [];
  private readonly poseTimes: number[] = [];
  private inferenceMs = 0;
  private handMs = 0;
  private latencyMs = 0;
  private lastJumpLatencyMs: number | null = null;
  /** Which menu hand to crop. Null skips the hand model, so pose does not wait on it. */
  private handSide: (() => Handedness | null) | null = null;

  constructor(video: HTMLVideoElement, bus: EventBus<GameEvents>) {
    this.video = video;
    this.bus = bus;
  }

  setProfile(profile: PoseProfile): void {
    this.profile = profile;
    this.body.setProfile(profile);
  }

  getProfile(): PoseProfile {
    return this.profile;
  }

  /** HandTracker sets this. Called on the pose thread before each frame is sent. */
  setHandSideSource(source: () => Handedness | null): void {
    this.handSide = source;
  }

  setDetectionEnabled(enabled: boolean): void {
    this.detectionEnabled = enabled;
    this.body.reset();
    if (!enabled) {
      this.bus.emit('poseRun', { active: false, intensity: 0 });
      this.bus.emit('poseCrouch', { active: false, depth01: 0 });
    }
  }

  /** Assumes `#webcam` already has an active MediaStream (see GameEngine.ensureCameraStarted). */
  async start(): Promise<void> {
    if (this.running) return;
    if (!this.video.srcObject) {
      throw new Error('PoseTracker.start() requires an active camera on the video element');
    }
    this.inference = await createPoseInference();
    console.info(
      `[pose] inference = ${this.inference.mode} · model = ${this.inference.model} · delegate = ${this.inference.delegate}`,
    );
    this.running = true;
    this.scheduleNextFrame();
  }

  stop(): void {
    this.running = false;
    this.detectionEnabled = false;
    if (this.rvfcHandle && this.video.cancelVideoFrameCallback) {
      this.video.cancelVideoFrameCallback(this.rvfcHandle);
      this.rvfcHandle = 0;
    }
    if (this.rafHandle) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = 0;
    }
    this.inference?.close();
    this.inference = null;
  }

  private scheduleNextFrame(): void {
    if (!this.running) return;
    if (typeof this.video.requestVideoFrameCallback === 'function') {
      this.rvfcHandle = this.video.requestVideoFrameCallback((now, meta) =>
        this.onVideoFrame(now, meta),
      );
      return;
    }
    this.rafHandle = requestAnimationFrame((now) => this.onVideoFrame(now));
  }

  private onVideoFrame(now: number, meta?: VideoFrameCallbackMetadata): void {
    if (!this.running || !this.inference) return;
    pushRate(this.cameraTimes, now);

    // One frame in flight: a queue would only add delay.
    if (this.busy) {
      this.scheduleNextFrame();
      return;
    }

    const frame = uprightFrame(this.video, meta?.presentedFrames ?? now);
    if (!frame) {
      this.scheduleNextFrame();
      return;
    }

    const captureTime = meta?.captureTime ?? meta?.presentationTime ?? now;
    const ts = Math.max(performance.now(), this.lastTimestampMs + 1);
    this.lastTimestampMs = ts;
    this.busy = true;
    const hand = this.handSide?.() ?? null;
    this.inference
      .detect(frame, ts, hand)
      .then((result) => this.handleResult(result, captureTime))
      .catch((error: unknown) => console.warn('[pose] detect failed:', error))
      .finally(() => {
        this.busy = false;
      });

    this.scheduleNextFrame();
  }

  private handleResult(result: PoseResult, captureTime: number): void {
    if (!this.running) return;
    const t = performance.now();
    this.latencyMs = t - captureTime;
    this.inferenceMs = result.inferenceMs;
    this.handMs = result.handMs;
    pushRate(this.poseTimes, t);

    const landmarks = result.landmarks ?? [];
    const world = result.world ?? [];
    const sample = landmarks.length > 0 ? readSample(landmarks, world) : null;
    this.bus.emit('poseFrame', { landmarks, world, sample, hand: result.hand, t });

    let frame: BodyFrame | null = null;
    if (this.detectionEnabled) {
      frame = this.body.update(sample, t);
      if (frame.valid) this.bus.emit('poseLane', { lane: frame.lane });
      this.bus.emit('poseRun', { active: frame.running, intensity: frame.runIntensity });
      this.bus.emit('poseCrouch', {
        active: frame.crouching,
        depth01: frame.airborne ? 0 : crouchDepth01(frame.crouchDepth, this.body.getThresholds().crouch),
      });
      if (frame.jumped) {
        this.lastJumpLatencyMs = t - captureTime;
        this.bus.emit('poseJump', { at: t });
      }
      if (frame.starJumped) this.bus.emit('poseStarJump', { at: t });
    }

    this.bus.emit('poseDebug', {
      mode: this.inference?.mode ?? 'main',
      model: this.inference?.model ?? '?',
      delegate: this.inference?.delegate ?? '?',
      cameraFps: rate(this.cameraTimes, t),
      poseFps: rate(this.poseTimes, t),
      inferenceMs: this.inferenceMs,
      handMs: this.handMs,
      latencyMs: this.latencyMs,
      lastJumpLatencyMs: this.lastJumpLatencyMs,
      body: frame,
      thresholds: this.detectionEnabled ? this.body.getThresholds() : null,
    });
  }
}

function pushRate(times: number[], t: number): void {
  times.push(t);
  while (times.length > 0 && t - times[0]! > 1000) times.shift();
}

function rate(times: number[], now: number): number {
  return times.filter((x) => now - x <= 1000).length;
}
