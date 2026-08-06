import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { LANDMARK, VISION } from '../config/GameConfig';
import type { EventBus } from '../core/EventBus';
import type {
  GameEvents,
  Gesture,
  IGestureSource,
  PoseLandmarkPoint,
  PoseSample,
} from '../core/types';
import { defaultProfile, type PoseProfile } from './PoseProfile';

export class PoseTracker implements IGestureSource {
  readonly name = 'pose' as const;

  private readonly video: HTMLVideoElement;
  private readonly bus: EventBus<GameEvents>;
  private landmarker: PoseLandmarker | null = null;
  private stream: MediaStream | null = null;
  private running = false;
  private detectionEnabled = false;
  private profile: PoseProfile = defaultProfile();
  private rafHandle = 0;
  private rvfcHandle = 0;
  private lastTimestampMs = -1;

  private jumpArmed = true;
  private leftArmed = true;
  private rightArmed = true;
  private duckActive = false;
  private lastEdgeAt = 0;

  private readonly onFrame: (now: number) => void;

  constructor(video: HTMLVideoElement, bus: EventBus<GameEvents>) {
    this.video = video;
    this.bus = bus;
    this.onFrame = (now) => this.processFrame(now);
  }

  setProfile(profile: PoseProfile): void {
    this.profile = profile;
  }

  getProfile(): PoseProfile {
    return this.profile;
  }

  setDetectionEnabled(enabled: boolean): void {
    this.detectionEnabled = enabled;
    if (!enabled) {
      this.jumpArmed = true;
      this.leftArmed = true;
      this.rightArmed = true;
      this.duckActive = false;
    }
  }

  async start(): Promise<void> {
    if (this.running) return;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
    });
    this.video.srcObject = this.stream;
    await this.video.play();

    const fileset = await FilesetResolver.forVisionTasks(VISION.WASM_BASE);
    this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: VISION.MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
    });

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

    this.landmarker?.close();
    this.landmarker = null;

    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.video.srcObject = null;
  }

  private scheduleNextFrame(): void {
    if (!this.running) return;
    if (typeof this.video.requestVideoFrameCallback === 'function') {
      this.rvfcHandle = this.video.requestVideoFrameCallback((now) => this.onFrame(now));
      return;
    }
    this.rafHandle = requestAnimationFrame((now) => this.onFrame(now));
  }

  private processFrame(now: number): void {
    if (!this.running || !this.landmarker) return;

    const timestampMs = Math.max(now, this.lastTimestampMs + 1);
    if (timestampMs <= this.lastTimestampMs) {
      this.scheduleNextFrame();
      return;
    }
    this.lastTimestampMs = timestampMs;

    try {
      this.landmarker.detectForVideo(this.video, timestampMs, (result) => {
        const pose = result.landmarks[0] as PoseLandmarkPoint[] | undefined;
        if (!pose) {
          this.bus.emit('poseFrame', { landmarks: [], sample: null });
          return;
        }

        const sample = this.readSample(pose);
        this.bus.emit('poseFrame', { landmarks: pose, sample });

        if (this.detectionEnabled && sample) {
          this.evaluateGestures(sample, timestampMs);
        }
      });
    } catch (error) {
      console.warn('[pose] detectForVideo failed:', error);
    }

    this.scheduleNextFrame();
  }

  private readSample(pose: PoseLandmarkPoint[]): PoseSample | null {
    const lShoulder = pose[LANDMARK.L_SHOULDER];
    const rShoulder = pose[LANDMARK.R_SHOULDER];
    const nose = pose[LANDMARK.NOSE];
    if (!lShoulder || !rShoulder || !nose) return null;

    const required = [lShoulder, rShoulder, nose];
    if (required.some((p) => (p.visibility ?? 0) < VISION.MIN_VISIBILITY)) return null;

    const lHip = pose[LANDMARK.L_HIP];
    const rHip = pose[LANDMARK.R_HIP];
    const hipsVisible =
      !!lHip &&
      !!rHip &&
      (lHip.visibility ?? 0) >= VISION.MIN_VISIBILITY &&
      (rHip.visibility ?? 0) >= VISION.MIN_VISIBILITY;

    return {
      shoulderMidY: (lShoulder.y + rShoulder.y) * 0.5,
      shoulderMidX: (lShoulder.x + rShoulder.x) * 0.5,
      hipMidY: hipsVisible && lHip && rHip ? (lHip.y + rHip.y) * 0.5 : null,
      shoulderWidth: Math.abs(lShoulder.x - rShoulder.x),
      noseX: nose.x,
      hipsVisible,
    };
  }

  private evaluateGestures(sample: PoseSample, now: number): void {
    const baseline = this.profile.baseline;
    const thresholds = this.profile.thresholds;
    const torso = Math.max(0.05, baseline.torsoHeight);
    const shoulderW = Math.max(0.05, baseline.shoulderWidth);

    // Image Y grows downward, so rising shoulders -> smaller Y.
    const shoulderDeltaUp = (baseline.shoulderY - sample.shoulderMidY) / torso;
    const shoulderDeltaDown = (sample.shoulderMidY - baseline.shoulderY) / torso;

    const noseDelta = sample.noseX - baseline.noseX;
    const shoulderDelta = sample.shoulderMidX - baseline.shoulderMidX;
    let lateral = (0.4 * noseDelta + 0.6 * shoulderDelta) / shoulderW;
    if (this.profile.mirror) lateral = -lateral;

    const cooldownOk = now - this.lastEdgeAt >= VISION.COOLDOWN_MS;

    // Duck is a held state.
    const ducking = shoulderDeltaDown >= thresholds.duck;
    if (ducking && !this.duckActive) {
      this.duckActive = true;
      this.emit('DUCK', now);
    } else if (!ducking && this.duckActive) {
      this.duckActive = false;
      this.emit('NEUTRAL', now);
    }

    // Jump edge.
    if (shoulderDeltaUp >= thresholds.jump) {
      if (this.jumpArmed && cooldownOk && !ducking) {
        this.jumpArmed = false;
        this.lastEdgeAt = now;
        this.emit('JUMP', now);
      }
    } else if (shoulderDeltaUp <= thresholds.jump * VISION.RELEASE_FACTOR) {
      this.jumpArmed = true;
    }

    // Lane edges (independent left/right thresholds).
    if (lateral <= -thresholds.laneLeft) {
      if (this.leftArmed && cooldownOk) {
        this.leftArmed = false;
        this.rightArmed = true;
        this.lastEdgeAt = now;
        this.emit('MOVE_LEFT', now);
      }
    } else if (lateral >= -thresholds.laneLeft * VISION.RELEASE_FACTOR) {
      this.leftArmed = true;
    }

    if (lateral >= thresholds.laneRight) {
      if (this.rightArmed && cooldownOk) {
        this.rightArmed = false;
        this.leftArmed = true;
        this.lastEdgeAt = now;
        this.emit('MOVE_RIGHT', now);
      }
    } else if (lateral <= thresholds.laneRight * VISION.RELEASE_FACTOR) {
      this.rightArmed = true;
    }
  }

  private emit(gesture: Gesture, at: number): void {
    this.bus.emit('gesture', {
      gesture,
      source: 'pose',
      at,
    });
  }
}
