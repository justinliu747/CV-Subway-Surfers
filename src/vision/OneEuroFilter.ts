/**
 * 1€ filter (Casiez, Roussel, Vogel — CHI 2012): a low-pass filter whose cutoff
 * rises with speed, so slow motion is steady and fast motion keeps little lag.
 */
export class OneEuroFilter {
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly dCutoff: number;
  private x: number | null = null;
  private dx = 0;
  private lastT: number | null = null;

  constructor(minCutoff: number, beta: number, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
    this.lastT = null;
  }

  /** Filtered value. */
  get value(): number | null {
    return this.x;
  }

  /** Filtered derivative, units per second. */
  get velocity(): number {
    return this.dx;
  }

  /** `t` in milliseconds. */
  filter(value: number, t: number): number {
    if (this.x === null || this.lastT === null) {
      this.x = value;
      this.dx = 0;
      this.lastT = t;
      return value;
    }

    const dt = Math.max(1e-3, (t - this.lastT) / 1000);
    this.lastT = t;

    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (rawDx - this.dx);

    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}
