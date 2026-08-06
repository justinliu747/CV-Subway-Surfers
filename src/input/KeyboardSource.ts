import { KEYS } from '../config/GameConfig';
import type { EventBus } from '../core/EventBus';
import type { GameEvents, Gesture, IGestureSource } from '../core/types';

export class KeyboardSource implements IGestureSource {
  readonly name = 'keyboard' as const;

  private readonly bus: EventBus<GameEvents>;
  private readonly onKeyDown: (event: KeyboardEvent) => void;
  private readonly onKeyUp: (event: KeyboardEvent) => void;
  private started = false;

  constructor(bus: EventBus<GameEvents>) {
    this.bus = bus;
    this.onKeyDown = (event) => this.handleKeyDown(event);
    this.onKeyUp = (event) => this.handleKeyUp(event);
  }

  async start(): Promise<void> {
    if (this.started) return;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.started = true;
  }

  stop(): void {
    if (!this.started) return;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.started = false;
  }

  private emit(gesture: Gesture): void {
    this.bus.emit('gesture', {
      gesture,
      source: 'keyboard',
      at: performance.now(),
    });
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.repeat) return;
    const code = event.code;

    if (KEYS.LEFT.includes(code as (typeof KEYS.LEFT)[number])) {
      event.preventDefault();
      this.emit('MOVE_LEFT');
      return;
    }
    if (KEYS.RIGHT.includes(code as (typeof KEYS.RIGHT)[number])) {
      event.preventDefault();
      this.emit('MOVE_RIGHT');
      return;
    }
    if (KEYS.JUMP.includes(code as (typeof KEYS.JUMP)[number])) {
      event.preventDefault();
      this.emit('JUMP');
      return;
    }
    if (KEYS.DUCK.includes(code as (typeof KEYS.DUCK)[number])) {
      event.preventDefault();
      this.emit('DUCK');
    }
  }

  private handleKeyUp(event: KeyboardEvent): void {
    if (!KEYS.DUCK.includes(event.code as (typeof KEYS.DUCK)[number])) return;
    this.emit('NEUTRAL');
  }
}
