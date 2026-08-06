import type { CalibrationUpdate, ValidateTarget } from '../core/types';

const VALIDATE_LABELS: Record<ValidateTarget, string> = {
  LANE_LEFT: 'Left',
  LANE_CENTER: 'Center',
  LANE_RIGHT: 'Right',
  JUMP: 'Jump',
  DUCK: 'Duck',
};

export class CalibrationScreen {
  private readonly overlay: HTMLElement;
  private readonly card: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly instructionEl: HTMLElement;
  private readonly countdownEl: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly stepperEl: HTMLElement;
  private readonly retryBtn: HTMLButtonElement;
  private readonly skipBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;

  private onRetry: (() => void) | null = null;
  private onSkip: (() => void) | null = null;
  private onCancel: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'screen-overlay';
    this.overlay.innerHTML = `
      <div class="screen-card calibration-card" data-role="card">
        <h2 data-role="title">Calibration</h2>
        <div class="countdown-num" data-role="countdown" hidden>—</div>
        <p data-role="instruction">Get ready…</p>
        <div class="progress-bar"><div class="progress-fill" data-role="progress"></div></div>
        <div class="validate-stepper" data-role="stepper" hidden></div>
        <div class="screen-actions">
          <button type="button" class="screen-btn" data-action="retry" hidden>Retry</button>
          <button type="button" class="screen-btn secondary" data-action="skip">Skip</button>
          <button type="button" class="screen-btn secondary" data-action="cancel">Cancel</button>
        </div>
      </div>
    `;

    this.card = this.overlay.querySelector('[data-role="card"]') as HTMLElement;
    this.titleEl = this.overlay.querySelector('[data-role="title"]') as HTMLElement;
    this.instructionEl = this.overlay.querySelector('[data-role="instruction"]') as HTMLElement;
    this.countdownEl = this.overlay.querySelector('[data-role="countdown"]') as HTMLElement;
    this.progressFill = this.overlay.querySelector('[data-role="progress"]') as HTMLElement;
    this.stepperEl = this.overlay.querySelector('[data-role="stepper"]') as HTMLElement;
    this.retryBtn = this.overlay.querySelector('[data-action="retry"]') as HTMLButtonElement;
    this.skipBtn = this.overlay.querySelector('[data-action="skip"]') as HTMLButtonElement;
    this.cancelBtn = this.overlay.querySelector('[data-action="cancel"]') as HTMLButtonElement;

    this.retryBtn.addEventListener('click', () => this.onRetry?.());
    this.skipBtn.addEventListener('click', () => this.onSkip?.());
    this.cancelBtn.addEventListener('click', () => this.onCancel?.());

    root.appendChild(this.overlay);
  }

  show(): void {
    this.overlay.classList.add('visible');
  }

  hide(): void {
    this.overlay.classList.remove('visible');
    this.card.classList.remove('validate-success');
  }

  update(update: CalibrationUpdate): void {
    this.instructionEl.textContent = update.instruction;
    this.progressFill.style.width = `${Math.max(0, Math.min(1, update.progress)) * 100}%`;

    const showCountdown = update.phase === 'countdown' && typeof update.countdown === 'number';
    this.countdownEl.hidden = !showCountdown;
    if (showCountdown) {
      this.countdownEl.textContent = String(update.countdown);
    }

    this.titleEl.textContent =
      update.phase === 'validate'
        ? 'Validate Moves'
        : update.phase === 'rejected'
          ? 'Try Again'
          : update.phase === 'done'
            ? 'Done'
            : 'Calibration';

    const showStepper = update.phase === 'validate';
    this.stepperEl.hidden = !showStepper;
    if (showStepper) {
      this.renderStepper(update);
    }

    this.card.classList.toggle('validate-success', !!update.validateSuccess);

    this.retryBtn.hidden = update.phase !== 'rejected';
    this.skipBtn.hidden = update.phase === 'done';
    this.skipBtn.textContent = update.phase === 'validate' ? 'Skip Validation' : 'Skip';
  }

  onRetryStep(cb: () => void): void {
    this.onRetry = cb;
  }

  onSkipStep(cb: () => void): void {
    this.onSkip = cb;
  }

  onCancelCalib(cb: () => void): void {
    this.onCancel = cb;
  }

  private renderStepper(update: CalibrationUpdate): void {
    const total = update.validateTotal ?? 5;
    const index = update.validateIndex ?? 0;
    const targets: ValidateTarget[] = [
      'LANE_LEFT',
      'LANE_CENTER',
      'LANE_RIGHT',
      'JUMP',
      'DUCK',
    ];

    this.stepperEl.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const dot = document.createElement('div');
      dot.className = 'validate-dot';
      if (i < index) dot.classList.add('done');
      else if (i === index) {
        dot.classList.add('current');
        if (update.validateSuccess) dot.classList.add('done');
      }
      const label = document.createElement('span');
      label.textContent = VALIDATE_LABELS[targets[i] ?? 'JUMP'] ?? String(i + 1);
      dot.appendChild(label);
      this.stepperEl.appendChild(dot);
    }
  }
}
