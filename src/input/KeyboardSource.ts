import { KEYS } from '../config/GameConfig';
import type { EventBus } from '../core/EventBus';
import type { GameEvents, Gesture, IGestureSource } from '../core/types';

export class KeyboardSource implements IGestureSource {
  readonly name = 'keyboard' as const;

  private readonly bus: EventBus<GameEvents>;
  private readonly onKeyDown: (event: KeyboardEvent) => void;
  private started = false;

  constructor(bus: EventBus<GameEvents>) {
    this.bus = bus;
    this.onKeyDown = (event) => this.handleKeyDown(event);
  }

  async start(): Promise<void> {
    if (this.started) return;
    window.addEventListener('keydown', this.onKeyDown);
    this.started = true;
  }

  stop(): void {
    if (!this.started) return;
    window.removeEventListener('keydown', this.onKeyDown);
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
    const bindings: Array<[readonly string[], Gesture]> = [
      [KEYS.LEFT, 'MOVE_LEFT'],
      [KEYS.RIGHT, 'MOVE_RIGHT'],
      [KEYS.JUMP, 'JUMP'],
      [KEYS.DUCK, 'DUCK'],
      [KEYS.STAR_JUMP, 'STAR_JUMP'],
    ];
    for (const [keys, gesture] of bindings) {
      if (keys.includes(code)) {
        event.preventDefault();
        this.emit(gesture);
        return;
      }
    }
  }
}
