/**
 * Procedural cartoon SFX via Web Audio API — no external audio assets.
 */
export class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private unlocked = false;

  /** Call from a user gesture (menu button) so browsers allow playback. */
  unlock(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    this.unlocked = true;
  }

  playJump(): void {
    this.whoop(220, 660, 0.14, 0.18);
  }

  playDuck(): void {
    this.whoop(380, 140, 0.12, 0.14);
  }

  playLane(): void {
    this.noiseSwoosh(0.08, 0.12);
  }

  playCoin(): void {
    this.chime([880, 1320], 0.12, 0.15);
  }

  playDeath(): void {
    this.whoop(180, 60, 0.35, 0.28);
    this.noiseSwoosh(0.2, 0.2);
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.unlocked = false;
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  private whoop(fromHz: number, toHz: number, duration: number, gain: number): void {
    if (!this.unlocked) return;
    const ctx = this.ensureContext();
    const master = this.master;
    if (!ctx || !master) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(fromHz, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, toHz), now + duration);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(g);
    g.connect(master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private chime(freqs: number[], duration: number, gain: number): void {
    if (!this.unlocked) return;
    const ctx = this.ensureContext();
    const master = this.master;
    if (!ctx || !master) return;

    const now = ctx.currentTime;
    for (let i = 0; i < freqs.length; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freqs[i]!;
      const start = now + i * 0.04;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(gain, start + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(g);
      g.connect(master);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    }
  }

  private noiseSwoosh(duration: number, gain: number): void {
    if (!this.unlocked) return;
    const ctx = this.ensureContext();
    const master = this.master;
    if (!ctx || !master) return;

    const samples = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i++) {
      const env = 1 - i / samples;
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(400, now + duration);
    filter.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(now);
    src.stop(now + duration + 0.02);
  }
}
