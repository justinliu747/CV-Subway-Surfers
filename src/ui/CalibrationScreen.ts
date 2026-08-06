import type { CalibrationUpdate } from '../core/types';

export class CalibrationScreen {
  private readonly overlay: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly instructionEl: HTMLElement;
  private readonly countdownEl: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly checklistEl: HTMLElement;
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
      <div class="screen-card calibration-card">
        <h2 data-role="title">Calibration</h2>
        <div class="countdown-num" data-role="countdown" hidden>—</div>
        <p data-role="instruction">Get ready…</p>
        <div class="progress-bar"><div class="progress-fill" data-role="progress"></div></div>
        <ul class="checklist" data-role="checklist" hidden>
          <li data-g="JUMP">Jump</li>
          <li data-g="DUCK">Duck</li>
          <li data-g="MOVE_LEFT">Hop Left</li>
          <li data-g="MOVE_RIGHT">Hop Right</li>
        </ul>
        <div class="screen-actions">
          <button type="button" class="screen-btn" data-action="retry" hidden>Retry</button>
          <button type="button" class="screen-btn secondary" data-action="skip">Skip</button>
          <button type="button" class="screen-btn secondary" data-action="cancel">Cancel</button>
        </div>
      </div>
    `;

    this.titleEl = this.overlay.querySelector('[data-role="title"]') as HTMLElement;
    this.instructionEl = this.overlay.querySelector('[data-role="instruction"]') as HTMLElement;
    this.countdownEl = this.overlay.querySelector('[data-role="countdown"]') as HTMLElement;
    this.progressFill = this.overlay.querySelector('[data-role="progress"]') as HTMLElement;
    this.checklistEl = this.overlay.querySelector('[data-role="checklist"]') as HTMLElement;
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

    const showChecklist = update.phase === 'validate';
    this.checklistEl.hidden = !showChecklist;
    if (showChecklist && update.validated) {
      for (const li of this.checklistEl.querySelectorAll('li')) {
        const key = li.getAttribute('data-g') as 'JUMP' | 'DUCK' | 'MOVE_LEFT' | 'MOVE_RIGHT' | null;
        li.classList.toggle('done', !!(key && update.validated[key]));
      }
    }

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
}
