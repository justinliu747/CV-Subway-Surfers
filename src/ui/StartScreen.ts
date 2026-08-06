export class StartScreen {
  private readonly root: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly metaEl: HTMLElement;
  private readonly motionBtn: HTMLButtonElement;
  private readonly calibrateBtn: HTMLButtonElement;

  private onKeyboard: (() => void) | null = null;
  private onMotion: (() => void) | null = null;
  private onCalibrate: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;

    this.overlay = document.createElement('div');
    this.overlay.className = 'screen-overlay';
    this.overlay.innerHTML = `
      <div class="screen-card">
        <h1>Motion Runner</h1>
        <p>An endless runner with keyboard or webcam pose controls.</p>
        <div class="screen-actions">
          <button type="button" class="screen-btn" data-action="keyboard">Play with Keyboard</button>
          <button type="button" class="screen-btn" data-action="motion">Motion Controls</button>
          <button type="button" class="screen-btn secondary" data-action="calibrate">Calibrate</button>
        </div>
        <div class="screen-meta" data-role="meta"></div>
      </div>
    `;

    this.metaEl = this.overlay.querySelector('[data-role="meta"]') as HTMLElement;
    this.motionBtn = this.overlay.querySelector('[data-action="motion"]') as HTMLButtonElement;
    this.calibrateBtn = this.overlay.querySelector('[data-action="calibrate"]') as HTMLButtonElement;

    this.overlay.querySelector('[data-action="keyboard"]')?.addEventListener('click', () => {
      this.onKeyboard?.();
    });
    this.motionBtn.addEventListener('click', () => this.onMotion?.());
    this.calibrateBtn.addEventListener('click', () => this.onCalibrate?.());

    this.root.appendChild(this.overlay);
  }

  show(opts: { backend: string; hasProfile: boolean }): void {
    this.calibrateBtn.textContent = opts.hasProfile ? 'Recalibrate' : 'Calibrate';
    this.motionBtn.textContent = opts.hasProfile ? 'Motion Controls' : 'Motion Controls';
    const profileText = opts.hasProfile
      ? 'Saved calibration found — Motion Controls ready.'
      : 'No saved calibration — Motion Controls will run setup.';
    this.metaEl.textContent = `Backend: ${opts.backend} · ${profileText}`;
    this.overlay.classList.add('visible');
  }

  hide(): void {
    this.overlay.classList.remove('visible');
  }

  onPlayKeyboard(cb: () => void): void {
    this.onKeyboard = cb;
  }

  onPlayMotion(cb: () => void): void {
    this.onMotion = cb;
  }

  onOpenCalibrate(cb: () => void): void {
    this.onCalibrate = cb;
  }
}
