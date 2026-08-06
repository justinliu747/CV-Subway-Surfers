import { HAND_UI } from '../config/GameConfig';
import type { EventBus } from '../core/EventBus';
import type {
  GameEvents,
  HandCalibrationUpdate,
  HandCornerId,
  HandCorners,
  Handedness,
  Vec2,
} from '../core/types';
import {
  averagePoints,
  validateHandCorners,
  type HandProfile,
} from './HandProfile';

const CORNER_ORDER: HandCornerId[] = ['tl', 'tr', 'br', 'bl'];

const CORNER_LABEL: Record<HandCornerId, string> = {
  tl: 'top-left',
  tr: 'top-right',
  br: 'bottom-right',
  bl: 'bottom-left',
};

type CalibStep = 'framing' | 'pinch' | 'open' | HandCornerId | 'rejected' | 'done';

export class HandCalibrator {
  private readonly bus: EventBus<GameEvents>;
  private unsubscribeFrame: (() => void) | null = null;
  private active = false;
  private step: CalibStep = 'framing';
  private framingCount = 0;
  private corners: Partial<HandCorners> = {};
  private cursorSamples: Vec2[] = [];
  private onComplete: ((profile: HandProfile | null) => void) | null = null;
  private waitingRelease = false;
  private handednessVotes: Partial<Record<Handedness, number>> = {};
  private lockedHandedness: Handedness | null = null;

  private pinchCycle = 0; // 0-based index into PINCH_CYCLES
  private sampleStartedAt = 0;
  private ratioSamples: number[] = [];
  private closedMeans: number[] = [];
  private openMeans: number[] = [];
  private pinchClose: number = HAND_UI.PINCH_RATIO_CLOSE;
  private pinchOpen: number = HAND_UI.PINCH_RATIO_OPEN;
  private onPinchThresholds: ((close: number, open: number) => void) | null = null;
  private onHandednessLock: ((handedness: Handedness) => void) | null = null;

  constructor(bus: EventBus<GameEvents>) {
    this.bus = bus;
  }

  /**
   * @param onPinchThresholds Called after successful pinch calib so HandTracker
   *   can use the new thresholds for the corner steps.
   * @param onHandednessLock Called after framing so HandTracker filters to that hand.
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
    this.step = 'framing';
    this.framingCount = 0;
    this.corners = {};
    this.cursorSamples = [];
    this.waitingRelease = false;
    this.handednessVotes = {};
    this.lockedHandedness = null;
    this.pinchCycle = 0;
    this.sampleStartedAt = 0;
    this.ratioSamples = [];
    this.closedMeans = [];
    this.openMeans = [];
    this.pinchClose = HAND_UI.PINCH_RATIO_CLOSE;
    this.pinchOpen = HAND_UI.PINCH_RATIO_OPEN;

    this.unsubscribeFrame = this.bus.on('handFrame', (frame) => {
      if (!this.active) return;
      this.onFrame(frame);
    });

    this.emitUpdate({
      phase: 'framing',
      instruction: 'Show the hand you will use for the menus.',
      progress: 0,
      captured: {},
    });
  }

  redoLastCorner(): void {
    if (!this.active) return;
    if (this.step === 'rejected') {
      // If pinch failed, restart pinch calib; otherwise redo missing corner.
      if (this.closedMeans.length < HAND_UI.PINCH_CYCLES || this.openMeans.length < HAND_UI.PINCH_CYCLES) {
        this.beginPinchCycle(0);
        return;
      }
      const next = this.nextMissingCorner();
      if (next) {
        this.beginCorner(next);
      } else {
        this.beginCorner('tl');
      }
      return;
    }

    if (this.step === 'pinch' || this.step === 'open') {
      this.beginPinchCycle(Math.max(0, this.pinchCycle));
      return;
    }

    const idx = CORNER_ORDER.indexOf(this.step as HandCornerId);
    if (idx < 0) return;
    if (idx === 0) {
      this.beginCorner('tl');
      return;
    }
    const prev = CORNER_ORDER[idx - 1]!;
    delete this.corners[prev];
    this.beginCorner(prev);
  }

  cancel(): void {
    if (!this.active) return;
    this.finish(null);
  }

  private onFrame(frame: {
    cursor: Vec2 | null;
    handedness: Handedness | null;
    pinchRatio: number | null;
    pinchHeld: boolean;
    pinchCommit: boolean;
    pinchProgress: number;
  }): void {
    if (frame.handedness) {
      this.noteHandedness(frame.handedness);
    }

    if (this.step === 'framing') {
      if (frame.cursor) {
        this.framingCount += 1;
      } else {
        this.framingCount = 0;
      }
      const progress = Math.min(1, this.framingCount / HAND_UI.FRAMING_FRAMES);
      this.emitUpdate({
        phase: 'framing',
        instruction: frame.cursor
          ? 'Hand detected — hold still…'
          : 'Show the hand you will use for the menus.',
        progress: progress * 0.15,
        pinchProgress: 0,
        captured: this.capturedFlags(),
      });
      if (this.framingCount >= HAND_UI.FRAMING_FRAMES) {
        this.lockedHandedness = this.majorityHandedness();
        this.onHandednessLock?.(this.lockedHandedness);
        this.beginPinchCycle(0);
      }
      return;
    }

    if (this.step === 'pinch' || this.step === 'open') {
      this.handlePinchSample(frame);
      return;
    }

    if (this.step === 'rejected' || this.step === 'done') return;
    if (!CORNER_ORDER.includes(this.step as HandCornerId)) return;

    const corner = this.step as HandCornerId;

    if (this.waitingRelease) {
      if (!frame.pinchHeld && frame.pinchProgress === 0) {
        this.waitingRelease = false;
        this.advanceAfterCorner(corner);
      }
      this.emitCorner(corner, frame.pinchProgress);
      return;
    }

    if (frame.cursor && (frame.pinchHeld || frame.pinchProgress > 0)) {
      this.cursorSamples.push(frame.cursor);
      if (this.cursorSamples.length > HAND_UI.CORNER_SAMPLE_FRAMES) {
        this.cursorSamples.shift();
      }
    }

    if (frame.pinchCommit && frame.cursor) {
      const sample =
        this.cursorSamples.length > 0 ? averagePoints(this.cursorSamples) : frame.cursor;
      this.corners[corner] = sample;
      this.cursorSamples = [];
      this.waitingRelease = true;
    }

    this.emitCorner(corner, frame.pinchProgress);
  }

  private handlePinchSample(frame: {
    cursor: Vec2 | null;
    pinchRatio: number | null;
  }): void {
    const isPinch = this.step === 'pinch';
    const cycleHuman = this.pinchCycle + 1;
    const total = HAND_UI.PINCH_CYCLES;

    if (!frame.cursor || frame.pinchRatio === null) {
      this.sampleStartedAt = 0;
      this.ratioSamples = [];
      this.emitUpdate({
        phase: isPinch ? 'pinch' : 'open',
        instruction: isPinch
          ? `PINCH and hold (${cycleHuman}/${total}) — keep your hand in view`
          : `OPEN your hand (${cycleHuman}/${total}) — keep your hand in view`,
        progress: this.pinchPhaseProgress(0),
        pinchProgress: 0,
        pinchCycle: cycleHuman,
        pinchCyclesTotal: total,
        captured: this.capturedFlags(),
      });
      return;
    }

    const now = performance.now();
    if (this.sampleStartedAt === 0) {
      this.sampleStartedAt = now;
      this.ratioSamples = [];
    }

    this.ratioSamples.push(frame.pinchRatio);
    const elapsed = now - this.sampleStartedAt;
    const dwell = Math.min(1, elapsed / HAND_UI.PINCH_SAMPLE_MS);

    this.emitUpdate({
      phase: isPinch ? 'pinch' : 'open',
      instruction: isPinch
        ? `PINCH and hold (${cycleHuman}/${total})`
        : `OPEN your hand (${cycleHuman}/${total})`,
      progress: this.pinchPhaseProgress(dwell),
      pinchProgress: dwell,
      pinchCycle: cycleHuman,
      pinchCyclesTotal: total,
      captured: this.capturedFlags(),
    });

    if (elapsed < HAND_UI.PINCH_SAMPLE_MS) return;

    const mean = this.mean(this.ratioSamples);
    if (isPinch) {
      this.closedMeans.push(mean);
      this.step = 'open';
      this.sampleStartedAt = 0;
      this.ratioSamples = [];
      this.emitUpdate({
        phase: 'open',
        instruction: `OPEN your hand (${cycleHuman}/${total})`,
        progress: this.pinchPhaseProgress(0),
        pinchProgress: 0,
        pinchCycle: cycleHuman,
        pinchCyclesTotal: total,
        captured: this.capturedFlags(),
      });
      return;
    }

    this.openMeans.push(mean);
    if (this.pinchCycle + 1 >= HAND_UI.PINCH_CYCLES) {
      this.finalizePinchCalib();
      return;
    }
    this.beginPinchCycle(this.pinchCycle + 1);
  }

  private pinchPhaseProgress(dwellInStep: number): number {
    // Framing = 0..0.15; pinch calib = 0.15..0.45; corners = 0.45..1
    const totalSteps = HAND_UI.PINCH_CYCLES * 2;
    const stepIndex = this.pinchCycle * 2 + (this.step === 'open' ? 1 : 0);
    const base = stepIndex / totalSteps;
    const within = dwellInStep / totalSteps;
    return 0.15 + (base + within) * 0.3;
  }

  private finalizePinchCalib(): void {
    const closedMean = this.mean(this.closedMeans);
    const openMean = this.mean(this.openMeans);
    const contrast = openMean - closedMean;

    if (!(contrast >= HAND_UI.PINCH_MIN_CONTRAST)) {
      this.step = 'rejected';
      this.closedMeans = [];
      this.openMeans = [];
      this.emitUpdate({
        phase: 'rejected',
        instruction:
          'Could not tell pinch from open. Try a clearer pinch vs fully open hand, then Retry.',
        progress: 0.15,
        captured: this.capturedFlags(),
      });
      return;
    }

    this.pinchClose =
      closedMean + (openMean - closedMean) * HAND_UI.PINCH_CLOSE_LERP;
    this.pinchOpen =
      closedMean + (openMean - closedMean) * HAND_UI.PINCH_OPEN_LERP;
    if (this.pinchOpen <= this.pinchClose) {
      this.pinchOpen = this.pinchClose + contrast * 0.15;
    }

    this.onPinchThresholds?.(this.pinchClose, this.pinchOpen);
    this.beginCorner('tl');
  }

  private beginPinchCycle(cycle: number): void {
    this.pinchCycle = cycle;
    this.step = 'pinch';
    this.sampleStartedAt = 0;
    this.ratioSamples = [];
    // Truncate means if restarting mid-way
    this.closedMeans = this.closedMeans.slice(0, cycle);
    this.openMeans = this.openMeans.slice(0, cycle);

    const cycleHuman = cycle + 1;
    this.emitUpdate({
      phase: 'pinch',
      instruction: `PINCH and hold (${cycleHuman}/${HAND_UI.PINCH_CYCLES})`,
      progress: this.pinchPhaseProgress(0),
      pinchProgress: 0,
      pinchCycle: cycleHuman,
      pinchCyclesTotal: HAND_UI.PINCH_CYCLES,
      captured: this.capturedFlags(),
    });
  }

  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private noteHandedness(label: Handedness): void {
    this.handednessVotes[label] = (this.handednessVotes[label] ?? 0) + 1;
  }

  private majorityHandedness(): Handedness {
    const left = this.handednessVotes.Left ?? 0;
    const right = this.handednessVotes.Right ?? 0;
    if (this.lockedHandedness) return this.lockedHandedness;
    return right > left ? 'Right' : 'Left';
  }

  private emitCorner(corner: HandCornerId, pinchProgress: number): void {
    const index = CORNER_ORDER.indexOf(corner);
    this.emitUpdate({
      phase: 'corner',
      corner,
      cornerIndex: index,
      instruction: `Pinch and hold at the ${CORNER_LABEL[corner]} of your interaction area.`,
      progress: 0.45 + ((index + Math.min(1, pinchProgress)) / CORNER_ORDER.length) * 0.55,
      pinchProgress,
      captured: this.capturedFlags(),
    });
  }

  private advanceAfterCorner(corner: HandCornerId): void {
    const index = CORNER_ORDER.indexOf(corner);
    if (index < CORNER_ORDER.length - 1) {
      this.beginCorner(CORNER_ORDER[index + 1]!);
      return;
    }

    const full = this.corners as HandCorners;
    const error = validateHandCorners(full);
    if (error) {
      this.step = 'rejected';
      this.emitUpdate({
        phase: 'rejected',
        instruction: error,
        progress: 0.45,
        captured: this.capturedFlags(),
      });
      return;
    }

    this.finish({
      version: HAND_UI.PROFILE_VERSION,
      corners: {
        tl: { ...full.tl },
        tr: { ...full.tr },
        br: { ...full.br },
        bl: { ...full.bl },
      },
      handedness: this.majorityHandedness(),
      pinchClose: this.pinchClose,
      pinchOpen: this.pinchOpen,
      createdAt: Date.now(),
    });
  }

  private beginCorner(corner: HandCornerId): void {
    this.step = corner;
    this.cursorSamples = [];
    this.waitingRelease = false;
    this.emitCorner(corner, 0);
  }

  private nextMissingCorner(): HandCornerId | null {
    for (const id of CORNER_ORDER) {
      if (!this.corners[id]) return id;
    }
    return null;
  }

  private capturedFlags(): Partial<Record<HandCornerId, boolean>> {
    return {
      tl: !!this.corners.tl,
      tr: !!this.corners.tr,
      br: !!this.corners.br,
      bl: !!this.corners.bl,
    };
  }

  private emitUpdate(update: HandCalibrationUpdate): void {
    this.bus.emit('handCalibration', update);
  }

  private finish(profile: HandProfile | null): void {
    const cb = this.onComplete;
    if (profile) {
      this.step = 'done';
      this.emitUpdate({
        phase: 'done',
        instruction: 'Hand UI setup complete!',
        progress: 1,
        captured: { tl: true, tr: true, br: true, bl: true },
      });
    }
    this.stopInternal(true);
    cb?.(profile);
  }

  private stopInternal(clearCallbacks: boolean): void {
    this.active = false;
    this.unsubscribeFrame?.();
    this.unsubscribeFrame = null;
    if (clearCallbacks) {
      this.onComplete = null;
      this.onPinchThresholds = null;
      this.onHandednessLock = null;
    }
  }
}
