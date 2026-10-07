import { HAND_LANDMARK, HAND_UI, LANDMARK, VISION } from '../config/GameConfig';
import type { EventBus } from '../core/EventBus';
import type { GameEvents, Handedness, PoseLandmarkPoint, Vec2 } from '../core/types';
import { uvToScreen, type HandProfile } from './HandProfile';
import { OneEuroFilter } from './OneEuroFilter';

const ARM: Record<Handedness, { shoulder: number; elbow: number; wrist: number }> = {
  Left: { shoulder: LANDMARK.L_SHOULDER, elbow: LANDMARK.L_ELBOW, wrist: LANDMARK.L_WRIST },
  Right: { shoulder: LANDMARK.R_SHOULDER, elbow: LANDMARK.R_ELBOW, wrist: LANDMARK.R_WRIST },
};

type Px = { x: number; y: number };

/**
 * Menu cursor and pinch, driven by pose frames.
 *
 * The cursor is the body tracker's wrist inside a pointing area anchored to the
 * active shoulder, so it works at full-body distance where the hand model alone
 * cannot find a hand. Pinch reads the hand landmarks that pose inference
 * returns from a wrist crop of that same frame.
 */
export class HandTracker {
  private readonly bus: EventBus<GameEvents>;
  private unsubscribe: (() => void) | null = null;
  private enabled = false;
  private profile: HandProfile | null = null;

  private pinching = false;
  private pinchStartedAt = 0;
  private pinchHeld = false;
  private pinchCommitLatched = false;

  /** Locked during setup before a profile exists; overridden by profile.handedness. */
  private sessionHandedness: Handedness | null = null;
  private sessionPinchClose: number | null = null;
  private sessionPinchOpen: number | null = null;

  private readonly fx = new OneEuroFilter(
    HAND_UI.CURSOR_MIN_CUTOFF,
    HAND_UI.CURSOR_BETA,
    HAND_UI.CURSOR_D_CUTOFF,
  );
  private readonly fy = new OneEuroFilter(
    HAND_UI.CURSOR_MIN_CUTOFF,
    HAND_UI.CURSOR_BETA,
    HAND_UI.CURSOR_D_CUTOFF,
  );

  constructor(bus: EventBus<GameEvents>) {
    this.bus = bus;
  }

  setProfile(profile: HandProfile | null): void {
    this.profile = profile;
    this.sessionHandedness = profile?.handedness ?? null;
    this.sessionPinchClose = profile?.pinchClose ?? null;
    this.sessionPinchOpen = profile?.pinchOpen ?? null;
    this.resetCursor();
    this.resetPinch();
  }

  getProfile(): HandProfile | null {
    return this.profile;
  }

  /** Apply pinch thresholds mid-setup, before the profile is saved. */
  setPinchThresholds(close: number, open: number): void {
    this.sessionPinchClose = close;
    this.sessionPinchOpen = open;
    this.resetPinch();
  }

  lockSessionHandedness(handedness: Handedness): void {
    this.sessionHandedness = handedness;
    this.resetCursor();
  }

  /** Fresh setup: drop the previous hand and pinch thresholds. */
  clearSessionHandedness(): void {
    this.sessionHandedness = null;
    this.sessionPinchClose = null;
    this.sessionPinchOpen = null;
    this.resetCursor();
    this.resetPinch();
  }

  /** When false, skip detection and emit nothing (required during RUNNING). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.resetPinch();
      this.resetCursor();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * The side pose inference should crop, or null when hand controls are off
   * or the menu hand is not chosen yet. Pose never runs the hand model for a
   * null request.
   */
  requestedHand(): Handedness | null {
    if (!this.enabled) return null;
    return this.activeSide();
  }

  /** Needs a running PoseTracker: it listens to poseFrame. The hand model lives there. */
  async start(): Promise<void> {
    if (this.unsubscribe) return;
    this.unsubscribe = this.bus.on('poseFrame', (frame) => this.onPoseFrame(frame.landmarks, frame.hand, frame.t));
  }

  stop(): void {
    this.enabled = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.resetPinch();
    this.resetCursor();
  }

  private onPoseFrame(pose: PoseLandmarkPoint[], hand: PoseLandmarkPoint[] | null, t: number): void {
    if (!this.enabled) return;
    if (pose.length === 0) {
      this.emitEmpty();
      return;
    }

    const px = (i: number): Px | null => {
      const p = pose[i];
      if (!p || (p.visibility ?? 0) < VISION.MIN_VISIBILITY) return null;
      return { x: p.x, y: p.y };
    };

    const raised: Record<Handedness, boolean> = { Left: false, Right: false };
    for (const side of ['Left', 'Right'] as const) {
      const e = px(ARM[side].elbow);
      const w = px(ARM[side].wrist);
      raised[side] = !!e && !!w && w.y < e.y;
    }

    const lShoulder = px(LANDMARK.L_SHOULDER);
    const rShoulder = px(LANDMARK.R_SHOULDER);
    const side = this.activeSide() ?? this.pickRaised(raised, px);
    const shoulder = side ? px(ARM[side].shoulder) : null;
    const wrist = side ? px(ARM[side].wrist) : null;
    if (!side || !lShoulder || !rShoulder || !shoulder || !wrist) {
      this.resetPinch();
      this.resetCursor();
      this.emitFrame(null, side, raised, null, false, 0);
      return;
    }

    const sw = Math.max(0.02, Math.hypot(lShoulder.x - rShoulder.x, lShoulder.y - rShoulder.y));
    const rx = (wrist.x - shoulder.x) / sw;
    const ry = (wrist.y - shoulder.y) / sw;
    const inZoneY = ry > -HAND_UI.ZONE_TOP - 0.3 && ry < HAND_UI.ZONE_HEIGHT - HAND_UI.ZONE_TOP;
    if (!inZoneY) {
      this.resetPinch();
      this.resetCursor();
      this.emitFrame(null, side, raised, null, false, 0);
      return;
    }

    const uImage = 0.5 + rx / HAND_UI.ZONE_WIDTH;
    const v = (ry + HAND_UI.ZONE_TOP) / HAND_UI.ZONE_HEIGHT;
    const u = HAND_UI.MIRROR_X ? 1 - uImage : uImage;
    const cursor: Vec2 = {
      x: clamp01(this.fx.filter(clamp01(u), t)),
      y: clamp01(this.fy.filter(clamp01(v), t)),
    };

    const pinchRatio = pinchRatioFrom(hand);
    let pinchCommit = false;
    let pinchProgress = 0;
    if (pinchRatio === null) {
      this.resetPinch();
    } else {
      ({ pinchCommit, pinchProgress } = this.updatePinch(pinchRatio, t));
    }
    this.emitFrame(cursor, side, raised, pinchRatio, pinchCommit, pinchProgress);
  }

  private activeSide(): Handedness | null {
    return this.profile?.handedness ?? this.sessionHandedness;
  }

  /** Before a hand is locked: the one raised hand, or the higher of two. */
  private pickRaised(
    raised: Record<Handedness, boolean>,
    px: (i: number) => Px | null,
  ): Handedness | null {
    if (raised.Left && !raised.Right) return 'Left';
    if (raised.Right && !raised.Left) return 'Right';
    if (!raised.Left && !raised.Right) return null;
    const l = px(ARM.Left.wrist);
    const r = px(ARM.Right.wrist);
    if (!l || !r) return null;
    return l.y < r.y ? 'Left' : 'Right';
  }

  private pinchClose(): number {
    return this.sessionPinchClose ?? HAND_UI.PINCH_RATIO_CLOSE;
  }

  private pinchOpen(): number {
    return this.sessionPinchOpen ?? HAND_UI.PINCH_RATIO_OPEN;
  }

  private resetPinch(): void {
    this.pinching = false;
    this.pinchStartedAt = 0;
    this.pinchHeld = false;
    this.pinchCommitLatched = false;
  }

  private resetCursor(): void {
    this.fx.reset();
    this.fy.reset();
  }

  private updatePinch(
    pinchRatio: number,
    now: number,
  ): { pinchCommit: boolean; pinchProgress: number } {
    if (!this.pinching) {
      if (pinchRatio <= this.pinchClose()) {
        this.pinching = true;
        this.pinchStartedAt = now;
        this.pinchHeld = false;
        this.pinchCommitLatched = false;
      }
    } else if (pinchRatio >= this.pinchOpen()) {
      this.resetPinch();
      return { pinchCommit: false, pinchProgress: 0 };
    }

    if (!this.pinching) return { pinchCommit: false, pinchProgress: 0 };

    const pinchProgress = Math.min(1, (now - this.pinchStartedAt) / HAND_UI.PINCH_HOLD_MS);
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

  private emitFrame(
    cursor: Vec2 | null,
    side: Handedness | null,
    raised: Record<Handedness, boolean>,
    pinchRatio: number | null,
    pinchCommit: boolean,
    pinchProgress: number,
  ): void {
    this.bus.emit('handFrame', {
      cursor,
      side,
      raised,
      pinchRatio,
      pinching: this.pinching,
      pinchHeld: this.pinchHeld,
      pinchCommit,
      pinchProgress,
    });
    const screen = cursor ? uvToScreen(cursor) : { x: 0, y: 0 };
    this.bus.emit('handPointer', {
      x: screen.x,
      y: screen.y,
      u: cursor?.x ?? 0,
      v: cursor?.y ?? 0,
      pinching: this.pinching,
      pinchHeld: this.pinchHeld,
      pinchCommit,
      pinchProgress,
      visible: cursor !== null,
    });
  }

  private emitEmpty(): void {
    this.resetPinch();
    this.emitFrame(null, null, { Left: false, Right: false }, null, false, 0);
  }
}

function pinchRatioFrom(hand: PoseLandmarkPoint[] | null): number | null {
  if (!hand) return null;
  const wristH = hand[HAND_LANDMARK.WRIST];
  const tip = hand[HAND_LANDMARK.INDEX_TIP];
  const thumb = hand[HAND_LANDMARK.THUMB_TIP];
  const mcp = hand[HAND_LANDMARK.MIDDLE_MCP];
  if (!wristH || !tip || !thumb || !mcp) return null;
  const scale = Math.max(HAND_UI.HAND_SCALE_MIN, Math.hypot(mcp.x - wristH.x, mcp.y - wristH.y));
  return Math.hypot(tip.x - thumb.x, tip.y - thumb.y) / scale;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
