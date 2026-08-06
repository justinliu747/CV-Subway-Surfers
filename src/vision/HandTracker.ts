import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { HAND_LANDMARK, HAND_UI, VISION } from '../config/GameConfig';
import type { EventBus } from '../core/EventBus';
import type { GameEvents, Handedness, PoseLandmarkPoint, Vec2 } from '../core/types';
import {
  parseHandedness,
  pointToUv,
  toDisplayPoint,
  uvToScreen,
  type HandProfile,
} from './HandProfile';

export class HandTracker {
  private readonly video: HTMLVideoElement;
  private readonly bus: EventBus<GameEvents>;
  private landmarker: HandLandmarker | null = null;
  private running = false;
  private enabled = false;
  private profile: HandProfile | null = null;
  private rafHandle = 0;
  private rvfcHandle = 0;
  private lastTimestampMs = -1;

  private pinching = false;
  private pinchStartedAt = 0;
  private pinchHeld = false;
  private pinchCommitLatched = false;

  /** Locked during calibration before a profile exists; overridden by profile.handedness. */
  private sessionHandedness: Handedness | null = null;
  /** Provisional thresholds after pinch calib, before full profile is saved. */
  private sessionPinchClose: number | null = null;
  private sessionPinchOpen: number | null = null;
  private smoothedCursor: Vec2 | null = null;

  private readonly onFrame: (now: number) => void;

  constructor(video: HTMLVideoElement, bus: EventBus<GameEvents>) {
    this.video = video;
    this.bus = bus;
    this.onFrame = (now) => this.processFrame(now);
  }

  setProfile(profile: HandProfile | null): void {
    this.profile = profile;
    if (profile) {
      this.sessionHandedness = profile.handedness;
      this.sessionPinchClose = profile.pinchClose;
      this.sessionPinchOpen = profile.pinchOpen;
    } else {
      // Full reset — recalibration must not keep the previous hand/pinch lock.
      this.sessionHandedness = null;
      this.sessionPinchClose = null;
      this.sessionPinchOpen = null;
    }
    this.smoothedCursor = null;
    this.resetPinch();
  }

  getProfile(): HandProfile | null {
    return this.profile;
  }

  /** Apply pinch thresholds mid-calibration (after open/close cycles). */
  setPinchThresholds(close: number, open: number): void {
    this.sessionPinchClose = close;
    this.sessionPinchOpen = open;
    this.resetPinch();
  }

  /** Lock which hand to track after framing majority-vote (calibration only). */
  lockSessionHandedness(handedness: Handedness): void {
    this.sessionHandedness = handedness;
  }

  /** Clear session lock when starting a fresh Hand UI calibration. */
  clearSessionHandedness(): void {
    this.sessionHandedness = null;
    this.sessionPinchClose = null;
    this.sessionPinchOpen = null;
    this.smoothedCursor = null;
    this.resetPinch();
  }

  getSessionHandedness(): Handedness | null {
    return this.profile?.handedness ?? this.sessionHandedness;
  }

  /** When false, skip detection and emit nothing (required during RUNNING). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.resetPinch();
      this.smoothedCursor = null;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Assumes `#webcam` already has an active MediaStream. */
  async start(): Promise<void> {
    if (this.running) return;

    if (!this.video.srcObject) {
      throw new Error('HandTracker.start() requires an active camera on the video element');
    }

    const fileset = await FilesetResolver.forVisionTasks(VISION.WASM_BASE);
    this.landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: VISION.HAND_MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 2,
    });

    this.running = true;
    this.scheduleNextFrame();
  }

  stop(): void {
    this.running = false;
    this.enabled = false;
    this.resetPinch();
    this.smoothedCursor = null;
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
  }

  private pinchClose(): number {
    return this.profile?.pinchClose ?? this.sessionPinchClose ?? HAND_UI.PINCH_RATIO_CLOSE;
  }

  private pinchOpen(): number {
    return this.profile?.pinchOpen ?? this.sessionPinchOpen ?? HAND_UI.PINCH_RATIO_OPEN;
  }

  private resetPinch(): void {
    this.pinching = false;
    this.pinchStartedAt = 0;
    this.pinchHeld = false;
    this.pinchCommitLatched = false;
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

    if (!this.enabled) {
      this.scheduleNextFrame();
      return;
    }

    try {
      const result = this.landmarker.detectForVideo(this.video, timestampMs);
      const selected = this.selectHand(result);
      if (!selected) {
        this.resetPinch();
        this.smoothedCursor = null;
        this.emitEmpty();
        this.scheduleNextFrame();
        return;
      }

      const { hand, handedness } = selected;
      // Do not auto-lock from the first frame — HandCalibrator locks after framing
      // majority-vote so recalibration can switch hands cleanly.

      const wristRaw = hand[HAND_LANDMARK.WRIST];
      const tipRaw = hand[HAND_LANDMARK.INDEX_TIP];
      const thumbRaw = hand[HAND_LANDMARK.THUMB_TIP];
      const mcpRaw = hand[HAND_LANDMARK.MIDDLE_MCP];
      if (!wristRaw || !tipRaw || !thumbRaw || !mcpRaw) {
        this.resetPinch();
        this.smoothedCursor = null;
        this.emitEmpty();
        this.scheduleNextFrame();
        return;
      }

      const wrist = toDisplayPoint({ x: wristRaw.x, y: wristRaw.y });
      const indexTip = toDisplayPoint({ x: tipRaw.x, y: tipRaw.y });
      const thumb = toDisplayPoint({ x: thumbRaw.x, y: thumbRaw.y });
      const mcp = toDisplayPoint({ x: mcpRaw.x, y: mcpRaw.y });

      const pinchDistance = Math.hypot(indexTip.x - thumb.x, indexTip.y - thumb.y);
      const handScale = Math.max(
        HAND_UI.HAND_SCALE_MIN,
        Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y),
      );
      const pinchRatio = pinchDistance / handScale;

      const cursor = this.smoothCursor(wrist);
      const { pinchCommit, pinchProgress } = this.updatePinch(pinchRatio, timestampMs);

      this.bus.emit('handFrame', {
        landmarks: hand,
        cursor,
        handedness,
        pinchDistance,
        pinchRatio,
        pinching: this.pinching,
        pinchHeld: this.pinchHeld,
        pinchCommit,
        pinchProgress,
      });

      this.emitPointer(cursor, pinchCommit, pinchProgress);
    } catch (error) {
      console.warn('[hands] detectForVideo failed:', error);
    }

    this.scheduleNextFrame();
  }

  private selectHand(result: {
    landmarks: Array<PoseLandmarkPoint[]>;
    handedness?: Array<Array<{ categoryName?: string; score?: number }>>;
  }): { hand: PoseLandmarkPoint[]; handedness: Handedness } | null {
    const preferred = this.profile?.handedness ?? this.sessionHandedness;
    const count = result.landmarks.length;

    for (let i = 0; i < count; i++) {
      const hand = result.landmarks[i] as PoseLandmarkPoint[] | undefined;
      if (!hand) continue;
      const label = parseHandedness(result.handedness?.[i]?.[0]?.categoryName);
      if (!label) continue;
      if (preferred && label !== preferred) continue;
      return { hand, handedness: label };
    }

    if (!preferred) {
      for (let i = 0; i < count; i++) {
        const hand = result.landmarks[i] as PoseLandmarkPoint[] | undefined;
        if (!hand) continue;
        const label = parseHandedness(result.handedness?.[i]?.[0]?.categoryName);
        if (!label) continue;
        return { hand, handedness: label };
      }
    }

    return null;
  }

  private smoothCursor(raw: Vec2): Vec2 {
    if (!this.smoothedCursor) {
      this.smoothedCursor = { ...raw };
      return this.smoothedCursor;
    }

    const delta = Math.hypot(raw.x - this.smoothedCursor.x, raw.y - this.smoothedCursor.y);
    const span = Math.max(1e-6, HAND_UI.CURSOR_SPEED_HI - HAND_UI.CURSOR_SPEED_LO);
    const t = Math.max(0, Math.min(1, (delta - HAND_UI.CURSOR_SPEED_LO) / span));
    const alpha =
      HAND_UI.CURSOR_ALPHA_SLOW +
      t * (HAND_UI.CURSOR_ALPHA_FAST - HAND_UI.CURSOR_ALPHA_SLOW);

    this.smoothedCursor = {
      x: alpha * raw.x + (1 - alpha) * this.smoothedCursor.x,
      y: alpha * raw.y + (1 - alpha) * this.smoothedCursor.y,
    };
    return this.smoothedCursor;
  }

  private updatePinch(
    pinchRatio: number,
    now: number,
  ): { pinchCommit: boolean; pinchProgress: number } {
    const close = this.pinchClose();
    const open = this.pinchOpen();

    if (!this.pinching) {
      if (pinchRatio <= close) {
        this.pinching = true;
        this.pinchStartedAt = now;
        this.pinchHeld = false;
        this.pinchCommitLatched = false;
      }
    } else if (pinchRatio >= open) {
      this.resetPinch();
      return { pinchCommit: false, pinchProgress: 0 };
    }

    if (!this.pinching) {
      return { pinchCommit: false, pinchProgress: 0 };
    }

    const heldFor = now - this.pinchStartedAt;
    const pinchProgress = Math.min(1, heldFor / HAND_UI.PINCH_HOLD_MS);
    let pinchCommit = false;

    if (pinchProgress >= 1) {
      if (!this.pinchCommitLatched) {
        this.pinchCommitLatched = true;
        pinchCommit = true;
      }
      this.pinchHeld = true;
    }

    return { pinchCommit, pinchProgress };
  }

  private emitPointer(cursor: Vec2, pinchCommit: boolean, pinchProgress: number): void {
    if (!this.profile) {
      const screen = uvToScreen(cursor);
      this.bus.emit('handPointer', {
        x: screen.x,
        y: screen.y,
        u: cursor.x,
        v: cursor.y,
        pinching: this.pinching,
        pinchHeld: this.pinchHeld,
        pinchCommit,
        pinchProgress,
        visible: true,
      });
      return;
    }

    const uv = pointToUv(cursor, this.profile.corners);
    const screen = uvToScreen(uv);
    this.bus.emit('handPointer', {
      x: screen.x,
      y: screen.y,
      u: uv.x,
      v: uv.y,
      pinching: this.pinching,
      pinchHeld: this.pinchHeld,
      pinchCommit,
      pinchProgress,
      visible: true,
    });
  }

  private emitEmpty(): void {
    this.bus.emit('handFrame', {
      landmarks: [],
      cursor: null,
      handedness: null,
      pinchDistance: null,
      pinchRatio: null,
      pinching: false,
      pinchHeld: false,
      pinchCommit: false,
      pinchProgress: 0,
    });
    this.bus.emit('handPointer', {
      x: 0,
      y: 0,
      u: 0,
      v: 0,
      pinching: false,
      pinchHeld: false,
      pinchCommit: false,
      pinchProgress: 0,
      visible: false,
    });
  }
}
