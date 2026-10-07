import { SCORE } from '../config/GameConfig';

export function loadHighScore(): number {
  try {
    const raw = localStorage.getItem(SCORE.STORAGE_KEY);
    if (raw == null) return 0;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function saveHighScore(value: number): void {
  const floored = Math.max(0, Math.floor(value));
  try {
    localStorage.setItem(SCORE.STORAGE_KEY, String(floored));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

/** Returns the new high score if `score` beats the saved one; otherwise the existing high. */
export function commitHighScore(score: number): { highScore: number; isNew: boolean } {
  const previous = loadHighScore();
  const floored = Math.floor(score);
  if (floored > previous) {
    saveHighScore(floored);
    return { highScore: floored, isNew: true };
  }
  return { highScore: previous, isNew: false };
}
