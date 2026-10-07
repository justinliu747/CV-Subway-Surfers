export class StartScreen {
  private readonly root: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly metaEl: HTMLElement;
  private readonly highScoreEl: HTMLElement;
  private readonly motionBtn: HTMLButtonElement;
  private readonly calibrateBtn: HTMLButtonElement;
  private readonly handUiBtn: HTMLButtonElement;

  private onKeyboard: (() => void) | null = null;
  private onMotion: (() => void) | null = null;
  private onCalibrate: (() => void) | null = null;
  private onHandUi: (() => void) | null = null;
  private onDebug: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;

    this.overlay = document.createElement('div');
    this.overlay.className = 'screen-overlay';
    this.overlay.innerHTML = `
      <div class="screen-card">
        <h1>Motion Runner</h1>
        <p>An endless runner with keyboard or webcam pose controls. Keyboard: J = star jump.</p>
        <div class="screen-high-score" data-role="high-score">High Score: 0</div>
        <div class="screen-actions">
          <button type="button" class="screen-btn" data-action="keyboard">Play with Keyboard</button>
          <button type="button" class="screen-btn" data-action="motion">Motion Controls</button>
          <button type="button" class="screen-btn secondary" data-action="calibrate">Calibrate</button>
          <button type="button" class="screen-btn secondary" data-action="hand-ui">Hand UI Setup</button>
          <button type="button" class="screen-btn secondary" data-action="debug">Debug</button>
        </div>
        <div class="screen-meta" data-role="meta"></div>
      </div>
    `;

    this.metaEl = this.overlay.querySelector('[data-role="meta"]') as HTMLElement;
    this.highScoreEl = this.overlay.querySelector('[data-role="high-score"]') as HTMLElement;
    this.motionBtn = this.overlay.querySelector('[data-action="motion"]') as HTMLButtonElement;
    this.calibrateBtn = this.overlay.querySelector('[data-action="calibrate"]') as HTMLButtonElement;
    this.handUiBtn = this.overlay.querySelector('[data-action="hand-ui"]') as HTMLButtonElement;

    this.overlay.querySelector('[data-action="keyboard"]')?.addEventListener('click', () => {
      this.onKeyboard?.();
    });
    this.motionBtn.addEventListener('click', () => this.onMotion?.());
    this.calibrateBtn.addEventListener('click', () => this.onCalibrate?.());
    this.handUiBtn.addEventListener('click', () => this.onHandUi?.());
    this.overlay.querySelector('[data-action="debug"]')?.addEventListener('click', () => {
      this.onDebug?.();
    });

    this.root.appendChild(this.overlay);
  }

  show(opts: {
    backend: string;
    hasProfile: boolean;
    hasHandProfile: boolean;
    handControlsActive: boolean;
    highScore: number;
  }): void {
    this.calibrateBtn.textContent = opts.hasProfile ? 'Recalibrate' : 'Calibrate';
    this.motionBtn.textContent = 'Motion Controls';
    if (!opts.hasHandProfile) {
      this.handUiBtn.textContent = 'Hand UI Setup';
    } else if (!opts.handControlsActive) {
      this.handUiBtn.textContent = 'Enable Hand Controls';
    } else {
      this.handUiBtn.textContent = 'Recalibrate Hand UI';
    }
    this.highScoreEl.textContent = `High Score: ${Math.floor(opts.highScore)}`;
    const profileText = opts.hasProfile
      ? 'Saved calibration found — Motion Controls ready.'
      : 'No saved calibration — Motion Controls will run setup.';
    const handText = !opts.hasHandProfile
      ? 'Hand UI needs setup (one-time click).'
      : opts.handControlsActive
        ? 'Hand UI active for menus.'
        : 'Hand UI saved — click Enable Hand Controls.';
    this.metaEl.textContent = `Backend: ${opts.backend} · ${profileText} · ${handText}`;
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

  onOpenHandUi(cb: () => void): void {
    this.onHandUi = cb;
  }

  onOpenDebug(cb: () => void): void {
    this.onDebug = cb;
  }
}
