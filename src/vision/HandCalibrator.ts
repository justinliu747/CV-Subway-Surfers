import { CALIBRATION, HAND_UI } from '../config/GameConfig';
import type { EventBus } from '../core/EventBus';
import type {
  CalibrationFeedback,
  GameEvents,
  HandCalibrationStep,
  HandFrameEvent,
  Handedness,
} from '../core/types';
import type { HandProfile } from './HandProfile';

const STEPS: HandCalibrationStep[] = ['raise', 'pinch'];

interface PinchRep {
  closed: number;
  open: number;
}

/**
 * Two prompts, like the body calibration: raise the menu hand (hold bar), then
 * pinch twice (rep dots). The pointing area comes from the body tracker, so
 * there are no corners to set. Pinch reps are found relative to your own open
 * hand, so no thresholds are needed before they are measured.
 */
export class HandCalibrator {
  private readonly bus: EventBus<GameEvents>;
  private unsubscribeFrame: (() => void) | null = null;
  private active = false;
  private step: HandCalibrationStep = 'raise';
  private stepStartedAt = 0;
  private hintOverride: string | null = null;
  private onComplete: ((profile: HandProfile | null) => void) | null = null;
  private onPinchThresholds: ((close: number, open: number) => void) | null = null;
  private onHandednessLock: ((handedness: Handedness) => void) | null = null;

  private handedness: Handedness | null = null;
  private raiseSide: Handedness | null = null;
  private raiseSince = 0;

  /** Recent pinch ratios; their max is your open hand. */
  private openWindow: Array<{ t: number; ratio: number }> = [];
  /** Set while a pinch is in progress: open reference at its start, lowest ratio so far. */
  private repOpen: number | null = null;
  private repMin = Infinity;
  private reps: PinchRep[] = [];

  private pinchClose: number = HAND_UI.PINCH_RATIO_CLOSE;
  private pinchOpen: number = HAND_UI.PINCH_RATIO_OPEN;
  private completeUntil: number | null = null;
  private completeFeedback: CalibrationFeedback = hold(1, 1);

  constructor(bus: EventBus<GameEvents>) {
    this.bus = bus;
  }

  /**
   * @param onPinchThresholds Lets HandTracker use the new thresholds right away.
   * @param onHandednessLock Lets HandTracker follow the chosen hand.
   */
  start(
    onComplete: (profile: HandProfile | null) => void,
    onPinchThresholds?: (close: number, open: number) => void,
    onHandednessLock?: (handedness: Handedness) => void,
  ): void {
    this.stopInternal(false);
    this.onComplete = onComplete;
    this.onPinchThresholds = onPinchThresholds ?? null;
    this.onHandednessLock = onHandednessLock ?? null;
    this.active = true;
    this.handedness = null;
    this.pinchClose = HAND_UI.PINCH_RATIO_CLOSE;
    this.pinchOpen = HAND_UI.PINCH_RATIO_OPEN;

    this.unsubscribeFrame = this.bus.on('handFrame', (frame) => {
      if (!this.active) return;
      this.onFrame(frame, performance.now());
    });
    this.enter('raise', performance.now());
  }

  cancel(): void {
    if (!this.active) return;
    this.finish(null);
  }

  private onFrame(frame: HandFrameEvent, now: number): void {
    if (this.completeUntil !== null) {
      if (now < this.completeUntil) {
        this.emit('Nice!', this.completeFeedback);
        return;
      }
      this.completeUntil = null;
      this.advance(now);
      return;
    }

    if (this.step === 'raise') this.handleRaise(frame, now);
    else if (this.step === 'pinch') this.handlePinch(frame, now);
  }

  private handleRaise(frame: HandFrameEvent, now: number): void {
    const { Left, Right } = frame.raised;
    const side: Handedness | null = Left === Right ? null : Left ? 'Left' : 'Right';
    if (!side) {
      this.raiseSide = null;
      this.emit(
        Left && Right ? 'Raise just one hand' : this.instruction(now),
        hold(0, HAND_UI.RAISE_HOLD_MS),
      );
      return;
    }
    if (side !== this.raiseSide) {
      this.raiseSide = side;
      this.raiseSince = now;
    }
    const span = now - this.raiseSince;
    if (span >= HAND_UI.RAISE_HOLD_MS) {
      this.handedness = side;
      this.onHandednessLock?.(side);
      this.complete(hold(1, 1), now);
      return;
    }
    this.emit(this.instruction(now), hold(span, HAND_UI.RAISE_HOLD_MS));
  }

  /**
   * A rep: the ratio drops below PINCH_REP_CLOSE × your open hand, then comes
   * back above PINCH_REP_OPEN × the same open value.
   */
  private handlePinch(frame: HandFrameEvent, now: number): void {
    const target = HAND_UI.PINCH_REPS;
    const ratio = frame.pinchRatio;
    if (frame.side !== this.handedness || ratio === null) {
      this.repOpen = null;
      this.repMin = Infinity;
      this.emit('Hold your hand up, palm toward the camera', reps(this.reps.length, target));
      return;
    }

    this.openWindow.push({ t: now, ratio });
    while (this.openWindow.length > 0 && now - this.openWindow[0]!.t > HAND_UI.PINCH_OPEN_WINDOW_MS) {
      this.openWindow.shift();
    }

    if (this.repOpen === null) {
      const open = Math.max(...this.openWindow.map((s) => s.ratio));
      if (ratio < open * HAND_UI.PINCH_REP_CLOSE) {
        this.repOpen = open;
        this.repMin = ratio;
      }
    } else {
      this.repMin = Math.min(this.repMin, ratio);
      if (ratio > this.repOpen * HAND_UI.PINCH_REP_OPEN) {
        this.reps.push({ closed: this.repMin, open: this.repOpen });
        this.repOpen = null;
        this.repMin = Infinity;
        if (this.reps.length >= target) {
          this.finishPinch(now);
          return;
        }
      }
    }
    this.emit(this.instruction(now), reps(this.reps.length, target));
  }

  private finishPinch(now: number): void {
    const target = HAND_UI.PINCH_REPS;
    const closed = mean(this.reps.map((r) => r.closed));
    const open = mean(this.reps.map((r) => r.open));
    const contrast = open - closed;
    if (!(contrast >= HAND_UI.PINCH_MIN_CONTRAST)) {
      this.enter('pinch', now);
      this.hintOverride = 'Pinch tighter, then open wide';
      this.emit(this.instruction(now), reps(0, target));
      return;
    }
    this.pinchClose = closed + contrast * HAND_UI.PINCH_CLOSE_LERP;
    this.pinchOpen = closed + contrast * HAND_UI.PINCH_OPEN_LERP;
    this.onPinchThresholds?.(this.pinchClose, this.pinchOpen);
    this.complete(reps(target, target), now);
  }

  private instruction(now: number): string {
    if (this.hintOverride) return this.hintOverride;
    const late = now - this.stepStartedAt >= CALIBRATION.HINT_AFTER_MS;
    switch (this.step) {
      case 'raise':
        return late ? 'Lift your hand above your elbow' : 'Raise the hand you will use for menus';
      case 'pinch':
        return late
          ? 'Touch thumb and index fingertip, then open wide'
          : 'Pinch twice — fingers together, then open';
      default:
        return 'Hand controls ready';
    }
  }

  private enter(step: HandCalibrationStep, now: number): void {
    this.step = step;
    this.stepStartedAt = now;
    this.hintOverride = null;
    this.raiseSide = null;
    this.openWindow = [];
    this.repOpen = null;
    this.repMin = Infinity;
    this.reps = [];
    this.emit(this.instruction(now), step === 'pinch' ? reps(0, HAND_UI.PINCH_REPS) : hold(0, 1));
  }

  /** Show the finished step (full bar or all dots) briefly, then move on. */
  private complete(feedback: CalibrationFeedback, now: number): void {
    this.completeUntil = now + CALIBRATION.SUCCESS_BEAT_MS;
    this.completeFeedback = feedback;
    this.emit('Nice!', feedback);
  }

  private advance(now: number): void {
    const next = STEPS[STEPS.indexOf(this.step) + 1];
    if (next) {
      this.enter(next, now);
      return;
    }
    this.finish({
      version: HAND_UI.PROFILE_VERSION,
      handedness: this.handedness ?? 'Right',
      pinchClose: this.pinchClose,
      pinchOpen: this.pinchOpen,
      createdAt: Date.now(),
    });
  }

  private emit(instruction: string, feedback: CalibrationFeedback): void {
    this.bus.emit('handCalibration', {
      step: this.step,
      stepIndex: this.step === 'done' ? STEPS.length : Math.max(0, STEPS.indexOf(this.step)),
      stepTotal: STEPS.length,
      instruction,
      feedback,
    });
  }

  private finish(profile: HandProfile | null): void {
    const cb = this.onComplete;
    if (profile) {
      this.step = 'done';
      this.emit('Hand controls ready', hold(1, 1));
    }
    this.stopInternal(true);
    cb?.(profile);
  }

  private stopInternal(clearCallbacks: boolean): void {
    this.active = false;
    this.completeUntil = null;
    this.unsubscribeFrame?.();
    this.unsubscribeFrame = null;
    if (clearCallbacks) {
      this.onComplete = null;
      this.onPinchThresholds = null;
      this.onHandednessLock = null;
    }
  }
}

function hold(value: number, target: number): CalibrationFeedback {
  return { kind: 'hold', value: Math.max(0, value), target };
}

function reps(value: number, target: number): CalibrationFeedback {
  return { kind: 'reps', value, target };
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
}
