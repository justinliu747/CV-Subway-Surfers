import { CALIBRATION, VISION } from '../config/GameConfig';
import type { EventBus } from '../core/EventBus';
import type {
  CalibrationStepId,
  CalibrationUpdate,
  GameEvents,
  Lane,
  LaneGuides,
  PoseSample,
  ValidateTarget,
} from '../core/types';
import { defaultProfile, laneSignal, type PoseProfile } from './PoseProfile';

type CaptureKind = 'lane_left' | 'lane_center' | 'lane_right' | 'jump' | 'duck';

interface CapturePeaks {
  jump: number;
  duck: number;
}

interface LaneCaptures {
  leftX: number | null;
  centerX: number | null;
  rightX: number | null;
}

const VALIDATE_SEQUENCE: ValidateTarget[] = [
  'LANE_LEFT',
  'LANE_CENTER',
  'LANE_RIGHT',
  'JUMP',
  'DUCK',
];

export class PoseCalibrator {
  private readonly bus: EventBus<GameEvents>;
  private unsubscribeFrame: (() => void) | null = null;
  private unsubscribeGesture: (() => void) | null = null;
  private unsubscribeLane: (() => void) | null = null;
  private active = false;
  private step: CalibrationStepId = 'framing';
  private framingCount = 0;
  private neutralCount = 0;
  private shoulderYSamples: number[] = [];
  private baseline = defaultProfile().baseline;
  private peaks: CapturePeaks = { jump: 0, duck: 0 };
  private lanes: LaneCaptures = { leftX: null, centerX: null, rightX: null };
  private laneSampleSum = 0;
  private laneSampleCount = 0;
  private captureKind: CaptureKind | null = null;
  private phaseStartedAt = 0;
  private currentDeviation = 0;
  private currentPeak = 0;
  private onComplete: ((profile: PoseProfile | null) => void) | null = null;
  private rejectReason = '';

  // Validation state machine
  private validateIndex = 0;
  private validateSuccess = false;
  private validateSuccessUntil = 0;
  private setDetection: ((enabled: boolean) => void) | null = null;
  private neutralHoldStartedAt: number | null = null;
  private laneDwellStartedAt: number | null = null;
  private gestureListening = false;

  constructor(bus: EventBus<GameEvents>) {
    this.bus = bus;
  }

  start(onComplete: (profile: PoseProfile | null) => void): void {
    this.stopInternal(false);
    this.onComplete = onComplete;
    this.active = true;
    this.step = 'framing';
    this.framingCount = 0;
    this.neutralCount = 0;
    this.shoulderYSamples = [];
    this.peaks = { jump: 0, duck: 0 };
    this.lanes = { leftX: null, centerX: null, rightX: null };
    this.laneSampleSum = 0;
    this.laneSampleCount = 0;
    this.captureKind = null;
    this.currentDeviation = 0;
    this.currentPeak = 0;
    this.rejectReason = '';
    this.baseline = defaultProfile().baseline;
    this.resetValidateState();

    this.unsubscribeFrame = this.bus.on('poseFrame', ({ sample }) => {
      if (!this.active || !sample) return;
      this.onSample(sample);
    });

    this.emitUpdate({
      phase: 'framing',
      step: 'framing',
      instruction: 'Stand so your nose, shoulders, and hips are all visible.',
      progress: 0,
    });
  }

  retryCurrentStep(): void {
    if (!this.active) return;
    if (this.step === 'rejected' && this.captureKind) {
      this.beginCountdown(this.captureKind);
      return;
    }
    if (this.isCaptureStep(this.step)) {
      this.beginCountdown(this.step);
    }
  }

  skip(): void {
    if (!this.active) return;
    // Skipping validation still keeps the measured profile.
    if (this.step === 'validate') {
      this.finish(this.buildProfile());
      return;
    }
    this.finish(null);
  }

  cancel(): void {
    if (!this.active) return;
    this.finish(null);
  }

  /**
   * Call when entering validation. `setDetection` is two-way so we can
   * disable detection between targets / during the neutral gate.
   */
  beginValidation(setDetection: (enabled: boolean) => void): void {
    if (!this.active || this.step !== 'validate') return;
    this.setDetection = setDetection;
    this.validateIndex = 0;
    this.validateSuccess = false;
    this.startValidateTarget();
  }

  private resetValidateState(): void {
    this.validateIndex = 0;
    this.validateSuccess = false;
    this.validateSuccessUntil = 0;
    this.setDetection = null;
    this.neutralHoldStartedAt = null;
    this.laneDwellStartedAt = null;
    this.gestureListening = false;
    this.unsubscribeGesture?.();
    this.unsubscribeGesture = null;
    this.unsubscribeLane?.();
    this.unsubscribeLane = null;
  }

  private onSample(sample: PoseSample): void {
    switch (this.step) {
      case 'framing':
        this.handleFraming(sample);
        break;
      case 'neutral':
        this.handleNeutral(sample);
        break;
      case 'lane_left':
      case 'lane_center':
      case 'lane_right':
      case 'jump':
      case 'duck':
        this.handleCaptureStep(sample);
        break;
      case 'validate':
        this.handleValidateSample(sample);
        break;
      default:
        break;
    }
  }

  private handleFraming(sample: PoseSample): void {
    const hipsOk = sample.hipsVisible;
    if (hipsOk) {
      this.framingCount += 1;
    } else {
      this.framingCount = 0;
    }

    const progress = Math.min(1, this.framingCount / CALIBRATION.FRAMING_FRAMES);
    const instruction = hipsOk
      ? 'Hold still — framing looks good…'
      : 'Step back until your hips are in frame.';

    this.emitUpdate({
      phase: 'framing',
      step: 'framing',
      instruction,
      progress,
    });

    if (this.framingCount >= CALIBRATION.FRAMING_FRAMES) {
      this.step = 'neutral';
      this.neutralCount = 0;
      this.shoulderYSamples = [];
      this.emitUpdate({
        phase: 'neutral',
        step: 'neutral',
        instruction: 'Stand still in the CENTER lane in a neutral pose.',
        progress: 0,
        highlightLane: 0,
      });
    }
  }

  private handleNeutral(sample: PoseSample): void {
    this.neutralCount += 1;
    const n = this.neutralCount;
    const torso =
      sample.hipMidY !== null
        ? Math.max(0.05, Math.abs(sample.shoulderMidY - sample.hipMidY))
        : Math.max(0.05, this.baseline.torsoHeight);

    this.baseline.shoulderY += (sample.shoulderMidY - this.baseline.shoulderY) / n;
    this.baseline.torsoHeight += (torso - this.baseline.torsoHeight) / n;
    this.baseline.shoulderWidth += (sample.shoulderWidth - this.baseline.shoulderWidth) / n;
    this.baseline.noseX += (sample.noseX - this.baseline.noseX) / n;
    this.baseline.shoulderMidX += (sample.shoulderMidX - this.baseline.shoulderMidX) / n;
    this.shoulderYSamples.push(sample.shoulderMidY);

    const progress = Math.min(1, n / CALIBRATION.NEUTRAL_FRAMES);
    this.emitUpdate({
      phase: 'neutral',
      step: 'neutral',
      instruction: 'Stand still in the CENTER lane in a neutral pose.',
      progress,
      highlightLane: 0,
    });

    if (n >= CALIBRATION.NEUTRAL_FRAMES) {
      this.baseline.noiseStdDev =
        this.stdDev(this.shoulderYSamples) / Math.max(0.05, this.baseline.torsoHeight);
      this.beginCountdown('lane_left');
    }
  }

  private beginCountdown(kind: CaptureKind): void {
    this.step = kind;
    this.captureKind = kind;
    this.phaseStartedAt = performance.now();
    this.currentDeviation = 0;
    this.currentPeak = 0;
    this.laneSampleSum = 0;
    this.laneSampleCount = 0;
    this.rejectReason = '';

    this.emitUpdate({
      phase: 'countdown',
      step: kind,
      instruction: this.instructionFor(kind),
      progress: 0,
      countdown: 3,
      deviation: 0,
      peak: 0,
      highlightLane: this.highlightFor(kind),
    });
  }

  private handleCaptureStep(sample: PoseSample): void {
    if (!this.captureKind || this.step !== this.captureKind) return;

    const elapsed = performance.now() - this.phaseStartedAt;

    if (elapsed < CALIBRATION.COUNTDOWN_MS) {
      const remaining = Math.ceil((CALIBRATION.COUNTDOWN_MS - elapsed) / 1000);
      this.emitUpdate({
        phase: 'countdown',
        step: this.captureKind,
        instruction: this.instructionFor(this.captureKind),
        progress: elapsed / CALIBRATION.COUNTDOWN_MS,
        countdown: Math.max(1, remaining),
        deviation: 0,
        peak: this.currentPeak,
        highlightLane: this.highlightFor(this.captureKind),
      });
      return;
    }

    const captureElapsed = elapsed - CALIBRATION.COUNTDOWN_MS;
    if (captureElapsed > CALIBRATION.CAPTURE_MS) {
      this.finalizeCapture();
      return;
    }

    if (this.isLaneCapture(this.captureKind)) {
      const signal = laneSignal(sample);
      this.laneSampleSum += signal;
      this.laneSampleCount += 1;
      this.currentDeviation = signal;
      this.currentPeak = this.laneSampleCount > 0 ? this.laneSampleSum / this.laneSampleCount : signal;

      this.emitUpdate({
        phase: 'capture',
        step: this.captureKind,
        instruction: `${this.instructionFor(this.captureKind)} — hold the position!`,
        progress: captureElapsed / CALIBRATION.CAPTURE_MS,
        deviation: this.currentDeviation,
        peak: this.currentPeak,
        highlightLane: this.highlightFor(this.captureKind),
      });
      return;
    }

    const deviation = this.measureDeviation(sample, this.captureKind);
    this.currentDeviation = Math.abs(deviation);
    if (deviation > this.currentPeak) {
      this.currentPeak = deviation;
    }

    this.emitUpdate({
      phase: 'capture',
      step: this.captureKind,
      instruction: `${this.instructionFor(this.captureKind)} — do it 2–3 times!`,
      progress: captureElapsed / CALIBRATION.CAPTURE_MS,
      deviation: this.currentDeviation,
      peak: Math.abs(this.currentPeak),
      highlightLane: this.highlightFor(this.captureKind),
    });
  }

  private finalizeCapture(): void {
    if (!this.captureKind) return;

    if (this.isLaneCapture(this.captureKind)) {
      this.finalizeLaneCapture();
      return;
    }

    const peakAbs = Math.abs(this.currentPeak);
    const noiseFloor = Math.max(0.005, this.baseline.noiseStdDev);
    const minPeak = noiseFloor * CALIBRATION.MIN_PEAK_OVER_NOISE;

    if (peakAbs < minPeak) {
      this.step = 'rejected';
      this.rejectReason = 'Not enough motion detected. Try a bigger movement.';
      this.emitUpdate({
        phase: 'rejected',
        step: 'rejected',
        instruction: this.rejectReason,
        progress: 0,
        deviation: this.currentDeviation,
        peak: peakAbs,
        highlightLane: this.highlightFor(this.captureKind),
      });
      return;
    }

    switch (this.captureKind) {
      case 'jump':
        this.peaks.jump = peakAbs;
        this.beginCountdown('duck');
        break;
      case 'duck':
        this.peaks.duck = peakAbs;
        this.enterValidate();
        break;
    }
  }

  private finalizeLaneCapture(): void {
    if (!this.captureKind || !this.isLaneCapture(this.captureKind)) return;

    if (this.laneSampleCount < 5) {
      this.step = 'rejected';
      this.rejectReason = 'Could not track your position. Try again.';
      this.emitUpdate({
        phase: 'rejected',
        step: 'rejected',
        instruction: this.rejectReason,
        progress: 0,
        highlightLane: this.highlightFor(this.captureKind),
      });
      return;
    }

    const avg = this.laneSampleSum / this.laneSampleCount;

    // Separation check against previously captured adjacent lanes.
    const prev = this.previousLaneValue(this.captureKind);
    if (prev !== null && Math.abs(avg - prev) < CALIBRATION.MIN_LANE_SEPARATION) {
      this.step = 'rejected';
      this.rejectReason = 'Not enough separation from the previous lane. Move farther sideways.';
      this.emitUpdate({
        phase: 'rejected',
        step: 'rejected',
        instruction: this.rejectReason,
        progress: 0,
        highlightLane: this.highlightFor(this.captureKind),
      });
      return;
    }

    switch (this.captureKind) {
      case 'lane_left':
        this.lanes.leftX = avg;
        this.beginCountdown('lane_center');
        break;
      case 'lane_center':
        this.lanes.centerX = avg;
        this.beginCountdown('lane_right');
        break;
      case 'lane_right':
        this.lanes.rightX = avg;
        this.beginCountdown('jump');
        break;
    }
  }

  private previousLaneValue(kind: CaptureKind): number | null {
    if (kind === 'lane_center') return this.lanes.leftX;
    if (kind === 'lane_right') return this.lanes.centerX;
    return null;
  }

  private enterValidate(): void {
    this.step = 'validate';
    this.validateIndex = 0;
    this.validateSuccess = false;
    this.emitValidateUpdate('Move into the LEFT lane and hold.');
    // GameEngine hooks beginValidation on the first validate-phase update.
  }

  private startValidateTarget(): void {
    this.unsubscribeGesture?.();
    this.unsubscribeGesture = null;
    this.unsubscribeLane?.();
    this.unsubscribeLane = null;
    this.neutralHoldStartedAt = null;
    this.laneDwellStartedAt = null;
    this.gestureListening = false;
    this.validateSuccess = false;
    this.setDetection?.(false);

    const target = VALIDATE_SEQUENCE[this.validateIndex];
    if (!target) {
      this.finish(this.buildProfile());
      return;
    }

    if (target === 'JUMP' || target === 'DUCK') {
      // Neutral gate: wait until user is actually standing still before enabling detection.
      this.emitValidateUpdate(
        target === 'JUMP'
          ? 'Stand neutrally, then JUMP when ready.'
          : 'Stand neutrally, then DUCK / crouch when ready.',
      );
      return;
    }

    // Lane targets: enable continuous lane detection immediately and require dwell.
    this.setDetection?.(true);
    this.unsubscribeLane = this.bus.on('poseLane', ({ lane }) => {
      if (!this.active || this.step !== 'validate' || this.validateSuccess) return;
      this.handleValidateLane(lane);
    });

    this.emitValidateUpdate(this.validateInstruction(target));
  }

  private handleValidateSample(sample: PoseSample): void {
    if (this.validateSuccess) {
      if (performance.now() >= this.validateSuccessUntil) {
        this.advanceValidate();
      }
      return;
    }

    const target = VALIDATE_SEQUENCE[this.validateIndex];
    if (!target) return;

    if (target === 'JUMP' || target === 'DUCK') {
      this.handleValidateGestureGate(sample, target);
    }
  }

  private handleValidateGestureGate(sample: PoseSample, target: 'JUMP' | 'DUCK'): void {
    if (this.gestureListening) return;

    const torso = Math.max(0.05, this.baseline.torsoHeight);
    const shoulderDeltaUp = (this.baseline.shoulderY - sample.shoulderMidY) / torso;
    const shoulderDeltaDown = (sample.shoulderMidY - this.baseline.shoulderY) / torso;
    const jumpThresh = this.deriveThreshold(this.peaks.jump, VISION.JUMP_RATIO);
    const duckThresh = this.deriveThreshold(this.peaks.duck, VISION.DUCK_RATIO);

    const isNeutral =
      shoulderDeltaUp < jumpThresh * VISION.RELEASE_FACTOR &&
      shoulderDeltaDown < duckThresh * VISION.RELEASE_FACTOR;

    if (!isNeutral) {
      this.neutralHoldStartedAt = null;
      return;
    }

    const now = performance.now();
    if (this.neutralHoldStartedAt === null) {
      this.neutralHoldStartedAt = now;
      return;
    }

    if (now - this.neutralHoldStartedAt < CALIBRATION.VALIDATE_NEUTRAL_MS) return;

    // Neutral held long enough — arm detection for this one gesture.
    this.gestureListening = true;
    this.setDetection?.(true);
    this.unsubscribeGesture = this.bus.on('gesture', ({ gesture, source }) => {
      if (!this.active || source !== 'pose' || this.validateSuccess) return;
      if (gesture === target) {
        this.markValidateSuccess();
      }
    });

    this.emitValidateUpdate(
      target === 'JUMP' ? 'Now JUMP!' : 'Now DUCK / crouch!',
    );
  }

  private handleValidateLane(lane: Lane): void {
    const target = VALIDATE_SEQUENCE[this.validateIndex];
    if (!target || this.validateSuccess) return;

    const expected = this.laneForTarget(target);
    if (expected === null) return;

    const now = performance.now();
    if (lane === expected) {
      if (this.laneDwellStartedAt === null) {
        this.laneDwellStartedAt = now;
      } else if (now - this.laneDwellStartedAt >= CALIBRATION.VALIDATE_LANE_DWELL_MS) {
        this.markValidateSuccess();
      } else {
        const dwellProgress =
          (now - this.laneDwellStartedAt) / CALIBRATION.VALIDATE_LANE_DWELL_MS;
        this.emitValidateUpdate(this.validateInstruction(target), dwellProgress);
      }
    } else {
      this.laneDwellStartedAt = null;
      this.emitValidateUpdate(this.validateInstruction(target), 0);
    }
  }

  private markValidateSuccess(): void {
    this.validateSuccess = true;
    this.validateSuccessUntil = performance.now() + CALIBRATION.VALIDATE_SUCCESS_PAUSE_MS;
    this.setDetection?.(false);
    this.unsubscribeGesture?.();
    this.unsubscribeGesture = null;
    this.unsubscribeLane?.();
    this.unsubscribeLane = null;
    this.emitValidateUpdate('Nice!', 1, true);
  }

  private advanceValidate(): void {
    this.validateIndex += 1;
    if (this.validateIndex >= VALIDATE_SEQUENCE.length) {
      this.finish(this.buildProfile());
      return;
    }
    this.startValidateTarget();
  }

  private emitValidateUpdate(instruction: string, progress = 0, success = false): void {
    const target = VALIDATE_SEQUENCE[this.validateIndex];
    this.emitUpdate({
      phase: 'validate',
      step: 'validate',
      instruction,
      progress,
      validateTarget: target,
      validateIndex: this.validateIndex,
      validateTotal: VALIDATE_SEQUENCE.length,
      validateSuccess: success,
      highlightLane: target ? this.laneForTarget(target) : null,
    });
  }

  private validateInstruction(target: ValidateTarget): string {
    switch (target) {
      case 'LANE_LEFT':
        return 'Move into the LEFT lane and hold.';
      case 'LANE_CENTER':
        return 'Move into the CENTER lane and hold.';
      case 'LANE_RIGHT':
        return 'Move into the RIGHT lane and hold.';
      case 'JUMP':
        return 'Stand neutrally, then JUMP when ready.';
      case 'DUCK':
        return 'Stand neutrally, then DUCK / crouch when ready.';
    }
  }

  private laneForTarget(target: ValidateTarget): Lane | null {
    switch (target) {
      case 'LANE_LEFT':
        return -1;
      case 'LANE_CENTER':
        return 0;
      case 'LANE_RIGHT':
        return 1;
      default:
        return null;
    }
  }

  private buildProfile(): PoseProfile {
    const leftX = this.lanes.leftX ?? 5 / 6;
    const centerX = this.lanes.centerX ?? 0.5;
    const rightX = this.lanes.rightX ?? 1 / 6;

    return {
      version: CALIBRATION.PROFILE_VERSION,
      baseline: { ...this.baseline },
      thresholds: {
        jump: this.deriveThreshold(this.peaks.jump, VISION.JUMP_RATIO),
        duck: this.deriveThreshold(this.peaks.duck, VISION.DUCK_RATIO),
      },
      lanes: { leftX, centerX, rightX },
      createdAt: Date.now(),
    };
  }

  /** In-progress profile so validation uses freshly captured lanes/thresholds. */
  draftProfile(): PoseProfile {
    return this.buildProfile();
  }

  private deriveThreshold(peakDelta: number, defaultRatio: number): number {
    const noiseFloor = Math.max(
      this.baseline.noiseStdDev * CALIBRATION.NOISE_MULTIPLIER,
      defaultRatio * CALIBRATION.THRESHOLD_FLOOR_FACTOR,
    );
    const ceiling = defaultRatio * CALIBRATION.THRESHOLD_CEILING_FACTOR;
    const raw = peakDelta * CALIBRATION.TRIGGER_FRACTION;
    return Math.min(ceiling, Math.max(noiseFloor, raw));
  }

  private measureDeviation(sample: PoseSample, kind: 'jump' | 'duck'): number {
    const torso = Math.max(0.05, this.baseline.torsoHeight);
    if (kind === 'jump') {
      return (this.baseline.shoulderY - sample.shoulderMidY) / torso;
    }
    return (sample.shoulderMidY - this.baseline.shoulderY) / torso;
  }

  private instructionFor(kind: CaptureKind): string {
    switch (kind) {
      case 'lane_left':
        return 'Jump / step into the LEFT lane';
      case 'lane_center':
        return 'Jump / step back to the CENTER lane';
      case 'lane_right':
        return 'Jump / step into the RIGHT lane';
      case 'jump':
        return 'Get ready to JUMP';
      case 'duck':
        return 'Get ready to DUCK / crouch';
    }
  }

  private highlightFor(kind: CaptureKind): Lane | null {
    switch (kind) {
      case 'lane_left':
        return -1;
      case 'lane_center':
        return 0;
      case 'lane_right':
        return 1;
      default:
        return null;
    }
  }

  private isLaneCapture(kind: CaptureKind): kind is 'lane_left' | 'lane_center' | 'lane_right' {
    return kind === 'lane_left' || kind === 'lane_center' || kind === 'lane_right';
  }

  private isCaptureStep(step: CalibrationStepId): step is CaptureKind {
    return (
      step === 'lane_left' ||
      step === 'lane_center' ||
      step === 'lane_right' ||
      step === 'jump' ||
      step === 'duck'
    );
  }

  private buildLaneGuides(): LaneGuides {
    return {
      leftX: this.lanes.leftX ?? 5 / 6,
      centerX: this.lanes.centerX ?? 0.5,
      rightX: this.lanes.rightX ?? 1 / 6,
    };
  }

  private stdDev(values: number[]): number {
    if (values.length < 2) return 0.01;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  private emitUpdate(update: Omit<CalibrationUpdate, 'laneGuides'> & { laneGuides?: LaneGuides }): void {
    this.bus.emit('calibration', {
      ...update,
      laneGuides: update.laneGuides ?? this.buildLaneGuides(),
    });
  }

  private finish(profile: PoseProfile | null): void {
    const cb = this.onComplete;
    this.setDetection?.(false);
    this.stopInternal(true);
    if (profile) {
      this.emitUpdate({
        phase: 'done',
        step: 'done',
        instruction: 'Calibration complete!',
        progress: 1,
      });
    }
    cb?.(profile);
  }

  private stopInternal(clearCallbacks: boolean): void {
    this.active = false;
    this.unsubscribeFrame?.();
    this.unsubscribeFrame = null;
    this.unsubscribeGesture?.();
    this.unsubscribeGesture = null;
    this.unsubscribeLane?.();
    this.unsubscribeLane = null;
    if (clearCallbacks) {
      this.onComplete = null;
      this.setDetection = null;
    }
  }
}
