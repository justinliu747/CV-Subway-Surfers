import type { GameState } from '../core/types';

export class HUD {
  private readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly stateEl: HTMLElement;
  private readonly statusEl: HTMLElement;
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

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'hud-status';
    this.statusEl.textContent = 'Starting…';
    this.root.appendChild(this.statusEl);

    this.gameOverActions = document.createElement('div');
    this.gameOverActions.className = 'screen-overlay';
    this.gameOverActions.innerHTML = `
      <div class="screen-card">
        <h2>Game Over</h2>
        <p>You hit an obstacle.</p>
        <div class="screen-actions">
          <button type="button" class="screen-btn" data-action="restart">Restart</button>
          <button type="button" class="screen-btn secondary" data-action="menu">Main Menu</button>
        </div>
      </div>
    `;
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
    const showHud = state === 'RUNNING' || state === 'GAME_OVER';
    this.panel.classList.toggle('hud-hidden', !showHud);
    this.statusEl.classList.toggle(
      'hud-hidden',
      state === 'START_MENU' || state === 'CALIBRATING' || state === 'HAND_CALIBRATING',
    );
    this.gameOverActions.classList.toggle('visible', state === 'GAME_OVER');
  }

  setScore(value: number): void {
    this.scoreEl.textContent = String(Math.floor(value));
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
