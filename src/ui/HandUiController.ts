import { HAND_UI } from '../config/GameConfig';
import type { EventBus } from '../core/EventBus';
import type { GameEvents, HandPointerEvent } from '../core/types';
import type { HandCursorOverlay } from './HandCursorOverlay';

/**
 * Maps hand pointer + pinch commits onto visible screen buttons.
 * Calls the real DOM click() so existing listeners fire unchanged.
 */
export class HandUiController {
  private readonly bus: EventBus<GameEvents>;
  private readonly cursor: HandCursorOverlay;
  private unsubscribe: (() => void) | null = null;
  private active = false;
  private hovered: HTMLButtonElement | null = null;
  private lastClickAt = 0;

  constructor(bus: EventBus<GameEvents>, cursor: HandCursorOverlay) {
    this.bus = bus;
    this.cursor = cursor;
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (active) {
      this.unsubscribe = this.bus.on('handPointer', (ev) => this.onPointer(ev));
    } else {
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.clearHover();
      this.cursor.setVisible(false);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    this.setActive(false);
  }

  private onPointer(ev: HandPointerEvent): void {
    if (!this.active) return;

    this.cursor.update({
      x: ev.x,
      y: ev.y,
      visible: ev.visible,
      pinching: ev.pinching,
      pinchHeld: ev.pinchHeld,
      pinchProgress: ev.pinchProgress,
    });

    if (!ev.visible) {
      this.clearHover();
      return;
    }

    const btn = this.hitTest(ev.x, ev.y);
    if (btn !== this.hovered) {
      this.hovered?.classList.remove('hand-hover');
      this.hovered = btn;
      this.hovered?.classList.add('hand-hover');
    }

    if (ev.pinchCommit && btn) {
      const now = performance.now();
      if (now - this.lastClickAt >= HAND_UI.CLICK_COOLDOWN_MS) {
        this.lastClickAt = now;
        btn.click();
      }
    }
  }

  private hitTest(x: number, y: number): HTMLButtonElement | null {
    const buttons = document.querySelectorAll<HTMLButtonElement>(
      '.screen-overlay.visible .screen-btn:not([hidden])',
    );
    for (const btn of buttons) {
      if (btn.disabled) continue;
      const r = btn.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return btn;
      }
    }
    return null;
  }

  private clearHover(): void {
    this.hovered?.classList.remove('hand-hover');
    this.hovered = null;
  }
}
