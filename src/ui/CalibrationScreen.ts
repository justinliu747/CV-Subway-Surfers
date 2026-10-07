import type { CalibrationUpdate, HandCalibrationUpdate } from '../core/types';

/** Shared by pose calibration and hand-control setup. */
export class CalibrationScreen {
  private readonly overlay: HTMLElement;
  private readonly label: string;
  private readonly titleEl: HTMLElement;
  private readonly instructionEl: HTMLElement;
  private readonly holdEl: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly repsEl: HTMLElement;
  private readonly cancelBtn: HTMLButtonElement;

  private onCancel: (() => void) | null = null;

  /** `label` prefixes the step counter, e.g. "Hand controls · Step 1 of 3". */
  constructor(root: HTMLElement, label = '') {
    this.label = label;
    this.overlay = document.createElement('div');
    this.overlay.className = 'screen-overlay';
    this.overlay.innerHTML = `
      <div class="screen-card calibration-card" data-role="card">
        <h2 data-role="title"></h2>
        <p data-role="instruction"></p>
        <div class="progress-bar" data-role="hold"><div class="progress-fill" data-role="progress"></div></div>
        <div class="rep-dots" data-role="reps" hidden></div>
        <div class="screen-actions">
          <button type="button" class="screen-btn secondary" data-action="cancel">Cancel</button>
        </div>
      </div>
    `;

    this.titleEl = this.overlay.querySelector('[data-role="title"]') as HTMLElement;
    this.instructionEl = this.overlay.querySelector('[data-role="instruction"]') as HTMLElement;
    this.holdEl = this.overlay.querySelector('[data-role="hold"]') as HTMLElement;
    this.progressFill = this.overlay.querySelector('[data-role="progress"]') as HTMLElement;
    this.repsEl = this.overlay.querySelector('[data-role="reps"]') as HTMLElement;
    this.cancelBtn = this.overlay.querySelector('[data-action="cancel"]') as HTMLButtonElement;

    this.cancelBtn.addEventListener('click', () => this.onCancel?.());
    root.appendChild(this.overlay);
  }

  show(): void {
    this.overlay.classList.add('visible');
  }

  hide(): void {
    this.overlay.classList.remove('visible');
  }

  update(update: CalibrationUpdate | HandCalibrationUpdate): void {
    const stepNumber = Math.min(update.stepTotal, update.stepIndex + 1);
    this.titleEl.textContent =
      update.step === 'done' ? 'Done' : `${this.label}Step ${stepNumber} of ${update.stepTotal}`;
    this.instructionEl.textContent = update.instruction;

    const hold = update.feedback.kind === 'hold';
    this.holdEl.hidden = !hold;
    this.repsEl.hidden = hold;
    if (hold) {
      const ratio = update.feedback.target > 0 ? update.feedback.value / update.feedback.target : 0;
      this.progressFill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
    } else {
      this.renderReps(update.feedback.value, update.feedback.target);
    }
  }

  onCancelCalib(cb: () => void): void {
    this.onCancel = cb;
  }

  private renderReps(done: number, total: number): void {
    this.repsEl.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const dot = document.createElement('span');
      dot.className = 'rep-dot';
      if (i < done) dot.classList.add('done');
      this.repsEl.appendChild(dot);
    }
  }
}
