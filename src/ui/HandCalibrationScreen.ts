import type { HandCalibrationUpdate, HandCornerId } from '../core/types';

const CORNER_LABEL: Record<HandCornerId, string> = {
  tl: 'Top Left',
  tr: 'Top Right',
  br: 'Bottom Right',
  bl: 'Bottom Left',
};

const CORNER_ORDER: HandCornerId[] = ['tl', 'tr', 'br', 'bl'];

export class HandCalibrationScreen {
  private readonly overlay: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly instructionEl: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly pinchFill: HTMLElement;
  private readonly pinchLabel: HTMLElement;
  private readonly targetsEl: HTMLElement;
  private readonly cycleEl: HTMLElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;

  private onRedo: (() => void) | null = null;
  private onCancel: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'screen-overlay';
    this.overlay.innerHTML = `
      <div class="screen-card calibration-card hand-calib-card">
        <h2 data-role="title">Hand UI Setup</h2>
        <p data-role="instruction">Get ready…</p>
        <div class="hand-cycle-badge" data-role="cycle" hidden></div>
        <div class="progress-bar"><div class="progress-fill" data-role="progress"></div></div>
        <div class="pinch-bar" data-role="pinch-wrap" hidden>
          <span class="pinch-label" data-role="pinch-label">Hold</span>
          <div class="progress-bar pinch-progress"><div class="progress-fill" data-role="pinch"></div></div>
        </div>
        <div class="hand-corner-targets" data-role="targets" hidden>
          <div class="hand-corner-dot" data-c="tl"><span>TL</span></div>
          <div class="hand-corner-dot" data-c="tr"><span>TR</span></div>
          <div class="hand-corner-dot" data-c="br"><span>BR</span></div>
          <div class="hand-corner-dot" data-c="bl"><span>BL</span></div>
        </div>
        <div class="screen-actions">
          <button type="button" class="screen-btn secondary" data-action="redo" hidden>Redo last</button>
          <button type="button" class="screen-btn secondary" data-action="cancel">Cancel</button>
        </div>
      </div>
    `;

    this.titleEl = this.overlay.querySelector('[data-role="title"]') as HTMLElement;
    this.instructionEl = this.overlay.querySelector('[data-role="instruction"]') as HTMLElement;
    this.progressFill = this.overlay.querySelector('[data-role="progress"]') as HTMLElement;
    this.pinchFill = this.overlay.querySelector('[data-role="pinch"]') as HTMLElement;
    this.pinchLabel = this.overlay.querySelector('[data-role="pinch-label"]') as HTMLElement;
    this.targetsEl = this.overlay.querySelector('[data-role="targets"]') as HTMLElement;
    this.cycleEl = this.overlay.querySelector('[data-role="cycle"]') as HTMLElement;
    this.redoBtn = this.overlay.querySelector('[data-action="redo"]') as HTMLButtonElement;
    this.cancelBtn = this.overlay.querySelector('[data-action="cancel"]') as HTMLButtonElement;

    this.redoBtn.addEventListener('click', () => this.onRedo?.());
    this.cancelBtn.addEventListener('click', () => this.onCancel?.());

    root.appendChild(this.overlay);
  }

  show(): void {
    this.overlay.classList.add('visible');
  }

  hide(): void {
    this.overlay.classList.remove('visible');
  }

  update(update: HandCalibrationUpdate): void {
    this.instructionEl.textContent = update.instruction;
    this.progressFill.style.width = `${Math.max(0, Math.min(1, update.progress)) * 100}%`;

    this.titleEl.textContent =
      update.phase === 'rejected'
        ? 'Try Again'
        : update.phase === 'done'
          ? 'Done'
          : update.phase === 'pinch' || update.phase === 'open'
            ? 'Pinch Calibration'
            : 'Hand UI Setup';

    const pinchWrap = this.overlay.querySelector('[data-role="pinch-wrap"]') as HTMLElement;
    const showDwell =
      update.phase === 'corner' || update.phase === 'pinch' || update.phase === 'open';
    pinchWrap.hidden = !showDwell;
    this.pinchFill.style.width = `${Math.max(0, Math.min(1, update.pinchProgress ?? 0)) * 100}%`;
    this.pinchLabel.textContent =
      update.phase === 'pinch'
        ? 'Pinch hold'
        : update.phase === 'open'
          ? 'Open hold'
          : 'Pinch hold';

    const showCycle = update.phase === 'pinch' || update.phase === 'open';
    this.cycleEl.hidden = !showCycle;
    if (showCycle && update.pinchCycle && update.pinchCyclesTotal) {
      this.cycleEl.textContent = `Cycle ${update.pinchCycle} / ${update.pinchCyclesTotal}`;
    }

    const showTargets = update.phase === 'corner' || update.phase === 'done';
    this.targetsEl.hidden = !showTargets;
    if (showTargets) {
      for (const id of CORNER_ORDER) {
        const dot = this.targetsEl.querySelector(`[data-c="${id}"]`) as HTMLElement | null;
        if (!dot) continue;
        const done = !!update.captured?.[id];
        const current = update.corner === id && update.phase === 'corner';
        dot.classList.toggle('done', done);
        dot.classList.toggle('current', current);
        const span = dot.querySelector('span');
        if (span) span.textContent = CORNER_LABEL[id].split(' ').map((w) => w[0]).join('');
      }
    }

    this.redoBtn.hidden = !(
      update.phase === 'corner' ||
      update.phase === 'rejected' ||
      update.phase === 'pinch' ||
      update.phase === 'open'
    );
    if (update.phase === 'corner' && update.cornerIndex === 0 && !update.captured?.tl) {
      this.redoBtn.hidden = true;
    }
    if (update.phase === 'pinch' && update.pinchCycle === 1) {
      this.redoBtn.hidden = true;
    }
  }

  onRedoStep(cb: () => void): void {
    this.onRedo = cb;
  }

  onCancelCalib(cb: () => void): void {
    this.onCancel = cb;
  }
}
