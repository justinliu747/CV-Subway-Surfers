import type { GameState } from '../core/types';

export class HUD {
  private readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly stateEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly staminaWrap: HTMLElement;
  private readonly staminaFill: HTMLElement;
  private readonly gameOverTitleEl: HTMLElement;
  private readonly gameOverMsgEl: HTMLElement;
  private readonly gameOverScoreEl: HTMLElement;
  private readonly gameOverHighEl: HTMLElement;
  private readonly gameOverNewEl: HTMLElement;
  private restartCallback: (() => void) | null = null;
  private menuCallback: (() => void) | null = null;
  private readonly gameOverActions: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.innerHTML = '';
    this.root.style.pointerEvents = 'none';

    this.panel = document.createElement('div');
    this.panel.className = 'hud-panel';
    this.scoreEl = document.createElement('div');
    this.scoreEl.className = 'hud-score';
    this.scoreEl.textContent = '0';
    this.stateEl = document.createElement('div');
    this.stateEl.className = 'hud-state';
    this.stateEl.textContent = 'BOOTING';
    this.panel.append(this.scoreEl, this.stateEl);
    this.root.appendChild(this.panel);

    this.staminaWrap = document.createElement('div');
    this.staminaWrap.className = 'hud-stamina hud-hidden';
    this.staminaWrap.innerHTML = `
      <div class="hud-stamina-label">Keep Running</div>
      <div class="progress-bar hud-stamina-bar"><div class="progress-fill" data-role="stamina"></div></div>
    `;
    this.staminaFill = this.staminaWrap.querySelector('[data-role="stamina"]') as HTMLElement;
    this.root.appendChild(this.staminaWrap);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'hud-status';
    this.statusEl.textContent = 'Starting…';
    this.root.appendChild(this.statusEl);

    this.gameOverActions = document.createElement('div');
    this.gameOverActions.className = 'screen-overlay';
    this.gameOverActions.innerHTML = `
      <div class="screen-card">
        <h2 data-role="go-title">Game Over</h2>
        <p data-role="go-msg">You hit an obstacle.</p>
        <div class="screen-score-block">
          <div class="screen-score-line">Score: <strong data-role="final-score">0</strong></div>
          <div class="screen-score-line">High Score: <strong data-role="high-score">0</strong></div>
          <div class="screen-new-high" data-role="new-high" hidden>New High Score!</div>
        </div>
        <div class="screen-actions">
          <button type="button" class="screen-btn" data-action="restart">Restart</button>
          <button type="button" class="screen-btn secondary" data-action="menu">Main Menu</button>
        </div>
      </div>
    `;
    this.gameOverTitleEl = this.gameOverActions.querySelector('[data-role="go-title"]') as HTMLElement;
    this.gameOverMsgEl = this.gameOverActions.querySelector('[data-role="go-msg"]') as HTMLElement;
    this.gameOverScoreEl = this.gameOverActions.querySelector(
      '[data-role="final-score"]',
    ) as HTMLElement;
    this.gameOverHighEl = this.gameOverActions.querySelector(
      '[data-role="high-score"]',
    ) as HTMLElement;
    this.gameOverNewEl = this.gameOverActions.querySelector(
      '[data-role="new-high"]',
    ) as HTMLElement;
    this.gameOverActions.querySelector('[data-action="restart"]')?.addEventListener('click', () => {
      this.restartCallback?.();
    });
    this.gameOverActions.querySelector('[data-action="menu"]')?.addEventListener('click', () => {
      this.menuCallback?.();
    });
    this.root.appendChild(this.gameOverActions);
  }

  setState(state: GameState): void {
    this.stateEl.textContent = state;
    const showHud = state === 'RUNNING' || state === 'CATCHING' || state === 'GAME_OVER';
    this.panel.classList.toggle('hud-hidden', !showHud);
    this.statusEl.classList.toggle(
      'hud-hidden',
      state === 'START_MENU' || state === 'CALIBRATING' || state === 'HAND_CALIBRATING',
    );
    this.gameOverActions.classList.toggle('visible', state === 'GAME_OVER');
    if (state !== 'RUNNING' && state !== 'CATCHING') {
      this.setStaminaVisible(false);
    }
  }

  setScore(value: number): void {
    this.scoreEl.textContent = String(Math.floor(value));
  }

  /** energy 1 = full (running), 0 = empty (about to be caught). */
  setStamina(energy: number): void {
    const e = Math.max(0, Math.min(1, energy));
    this.staminaFill.style.width = `${e * 100}%`;
    this.staminaFill.classList.toggle('stamina-warn', e < 0.35);
    this.staminaFill.classList.toggle('stamina-ok', e >= 0.35);
  }

  setStaminaVisible(visible: boolean): void {
    this.staminaWrap.classList.toggle('hud-hidden', !visible);
  }

  setGameOverScores(opts: {
    score: number;
    highScore: number;
    isNewHigh: boolean;
    title?: string;
    message?: string;
  }): void {
    this.gameOverTitleEl.textContent = opts.title ?? 'Game Over';
    this.gameOverMsgEl.textContent = opts.message ?? 'You hit an obstacle.';
    this.gameOverScoreEl.textContent = String(Math.floor(opts.score));
    this.gameOverHighEl.textContent = String(Math.floor(opts.highScore));
    this.gameOverNewEl.hidden = !opts.isNewHigh;
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  onRestart(cb: () => void): void {
    this.restartCallback = cb;
  }

  onMainMenu(cb: () => void): void {
    this.menuCallback = cb;
  }
}
