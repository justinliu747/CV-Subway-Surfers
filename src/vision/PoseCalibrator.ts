import { CALIBRATION, VISION } from '../config/GameConfig';
import type { EventBus } from '../core/EventBus';
import type {
  CalibrationStepId,
  CalibrationUpdate,
  GameEvents,
  Gesture,
  PoseSample,
} from '../core/types';
import { defaultProfile, type PoseProfile } from './PoseProfile';

type CaptureKind = 'jump' | 'duck' | 'hop_left' | 'hop_right';

interface CapturePeaks {
  jump: number;
  duck: number;
  hopLeftSigned: number;
  hopRightSigned: number;
}

export class PoseCalibrator {
  private readonly bus: EventBus<GameEvents>;
  private unsubscribeFrame: (() => void) | null = null;
  private unsubscribeGesture: (() => void) | null = null;
  private active = false;
  private step: CalibrationStepId = 'framing';
  private framingCount = 0;
  private neutralCount = 0;
  private shoulderYSamples: number[] = [];
  private baseline = defaultProfile().baseline;
  private peaks: CapturePeaks = { jump: 0, duck: 0, hopLeftSigned: 0, hopRightSigned: 0 };
  private captureKind: CaptureKind | null = null;
  private phaseStartedAt = 0;
  private currentDeviation = 0;
  private currentPeak = 0;
  private validated: Partial<Record<'JUMP' | 'DUCK' | 'MOVE_LEFT' | 'MOVE_RIGHT', boolean>> = {};
  private onComplete: ((profile: PoseProfile | null) => void) | null = null;
  private rejectReason = '';

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
    this.peaks = { jump: 0, duck: 0, hopLeftSigned: 0, hopRightSigned: 0 };
    this.captureKind = null;
    this.currentDeviation = 0;
    this.currentPeak = 0;
    this.validated = {};
    this.rejectReason = '';
    this.baseline = defaultProfile().baseline;

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

  /** Call when entering validation so pose gestures update the checklist. */
  beginValidation(enableDetection: () => void): void {
    if (!this.active || this.step !== 'validate') return;
    enableDetection();
    this.unsubscribeGesture?.();
    this.unsubscribeGesture = this.bus.on('gesture', ({ gesture, source }) => {
      if (!this.active || source !== 'pose') return;
      this.markValidated(gesture);
    });
    this.emitValidate();
  }

  private onSample(sample: PoseSample): void {
    switch (this.step) {
      case 'framing':
        this.handleFraming(sample);
        break;
      case 'neutral':
        this.handleNeutral(sample);
        break;
      case 'jump':
      case 'duck':
      case 'hop_left':
      case 'hop_right':
        this.handleCaptureStep(sample);
        break;
      default:
        break;
    }
  }

  private handleFraming(sample: PoseSample): void {
    const noseOk = true; // sample already requires nose/shoulders
    const hipsOk = sample.hipsVisible;
    if (noseOk && hipsOk) {
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
        instruction: 'Stand still in a neutral pose.',
        progress: 0,
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
      instruction: 'Stand still in a neutral pose.',
      progress,
    });

    if (n >= CALIBRATION.NEUTRAL_FRAMES) {
      this.baseline.noiseStdDev = this.stdDev(this.shoulderYSamples) / Math.max(0.05, this.baseline.torsoHeight);
      this.beginCountdown('jump');
    }
  }

  private beginCountdown(kind: CaptureKind): void {
    this.step = kind;
    this.captureKind = kind;
    this.phaseStartedAt = performance.now();
    this.currentDeviation = 0;
    this.currentPeak = 0;
    this.rejectReason = '';

    this.emitUpdate({
      phase: 'countdown',
      step: kind,
      instruction: this.instructionFor(kind),
      progress: 0,
      countdown: 3,
      deviation: 0,
      peak: 0,
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
      });
      return;
    }

    const captureElapsed = elapsed - CALIBRATION.COUNTDOWN_MS;
    if (captureElapsed > CALIBRATION.CAPTURE_MS) {
      this.finalizeCapture();
      return;
    }

    const deviation = this.measureDeviation(sample, this.captureKind);
    this.currentDeviation = Math.abs(deviation);
    if (this.captureKind === 'hop_left' || this.captureKind === 'hop_right') {
      // Keep signed peak with largest magnitude for mirror inference.
      if (Math.abs(deviation) > Math.abs(this.currentPeak)) {
        this.currentPeak = deviation;
      }
    } else if (deviation > this.currentPeak) {
      this.currentPeak = deviation;
    }

    this.emitUpdate({
      phase: 'capture',
      step: this.captureKind,
      instruction: `${this.instructionFor(this.captureKind)} — do it 2–3 times!`,
      progress: captureElapsed / CALIBRATION.CAPTURE_MS,
      deviation: this.currentDeviation,
      peak: Math.abs(this.currentPeak),
    });
  }

  private finalizeCapture(): void {
    if (!this.captureKind) return;

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
        this.beginCountdown('hop_left');
        break;
      case 'hop_left':
        this.peaks.hopLeftSigned = this.currentPeak;
        this.beginCountdown('hop_right');
        break;
      case 'hop_right':
        this.peaks.hopRightSigned = this.currentPeak;
        this.enterValidate();
        break;
    }
  }

  private enterValidate(): void {
    this.step = 'validate';
    this.validated = {};
    this.emitValidate();
  }

  private emitValidate(): void {
    this.emitUpdate({
      phase: 'validate',
      step: 'validate',
      instruction: 'Try each move once to confirm tracking.',
      progress: this.validationProgress(),
      validated: { ...this.validated },
    });

    if (this.validationProgress() >= 1) {
      this.finish(this.buildProfile());
    }
  }

  private markValidated(gesture: Gesture): void {
    if (gesture === 'NEUTRAL') return;
    if (gesture === 'JUMP' || gesture === 'DUCK' || gesture === 'MOVE_LEFT' || gesture === 'MOVE_RIGHT') {
      this.validated[gesture] = true;
      this.emitValidate();
    }
  }

  private validationProgress(): number {
    const keys: Array<'JUMP' | 'DUCK' | 'MOVE_LEFT' | 'MOVE_RIGHT'> = [
      'JUMP',
      'DUCK',
      'MOVE_LEFT',
      'MOVE_RIGHT',
    ];
    const done = keys.filter((k) => this.validated[k]).length;
    return done / keys.length;
  }

  private buildProfile(): PoseProfile {
    // Physical hop left should produce a signed lateral delta. If the measured
    // hop-left peak is positive (after the default mirror assumption), flip mirror.
    // We measure in image space before applying mirror, then decide mirror so that
    // "hop left" maps to negative lateral after mirror correction.
    let mirror: boolean = VISION.MIRROR;
    const hopLeftRaw = this.peaks.hopLeftSigned;
    // Without mirror: leaning toward image-left decreases x. With webcam mirror
    // preview, physical left often increases image x. If hop_left peak is > 0 in
    // raw image space, enabling mirror will make it negative (desired for MOVE_LEFT).
    if (hopLeftRaw > 0) {
      mirror = true;
    } else if (hopLeftRaw < 0) {
      mirror = false;
    }

    const hopLeftAbs = Math.abs(this.peaks.hopLeftSigned);
    const hopRightAbs = Math.abs(this.peaks.hopRightSigned);

    return {
      version: CALIBRATION.PROFILE_VERSION,
      baseline: { ...this.baseline },
      thresholds: {
        jump: this.deriveThreshold(this.peaks.jump, VISION.JUMP_RATIO),
        duck: this.deriveThreshold(this.peaks.duck, VISION.DUCK_RATIO),
        laneLeft: this.deriveThreshold(hopLeftAbs, VISION.LANE_RATIO),
        laneRight: this.deriveThreshold(hopRightAbs, VISION.LANE_RATIO),
      },
      mirror,
      createdAt: Date.now(),
    };
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

  private measureDeviation(sample: PoseSample, kind: CaptureKind): number {
    const torso = Math.max(0.05, this.baseline.torsoHeight);
    const shoulderW = Math.max(0.05, this.baseline.shoulderWidth);

    if (kind === 'jump') {
      return (this.baseline.shoulderY - sample.shoulderMidY) / torso;
    }
    if (kind === 'duck') {
      return (sample.shoulderMidY - this.baseline.shoulderY) / torso;
    }

    const noseDelta = sample.noseX - this.baseline.noseX;
    const shoulderDelta = sample.shoulderMidX - this.baseline.shoulderMidX;
    return (0.4 * noseDelta + 0.6 * shoulderDelta) / shoulderW;
  }

  private instructionFor(kind: CaptureKind): string {
    switch (kind) {
      case 'jump':
        return 'Get ready to JUMP';
      case 'duck':
        return 'Get ready to DUCK / crouch';
      case 'hop_left':
        return 'Get ready to HOP LEFT';
      case 'hop_right':
        return 'Get ready to HOP RIGHT';
    }
  }

  private isCaptureStep(step: CalibrationStepId): step is CaptureKind {
    return step === 'jump' || step === 'duck' || step === 'hop_left' || step === 'hop_right';
  }

  private stdDev(values: number[]): number {
    if (values.length < 2) return 0.01;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  private emitUpdate(update: CalibrationUpdate): void {
    this.bus.emit('calibration', update);
  }

  private finish(profile: PoseProfile | null): void {
    const cb = this.onComplete;
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
    if (clearCallbacks) {
      this.onComplete = null;
    }
  }
}
