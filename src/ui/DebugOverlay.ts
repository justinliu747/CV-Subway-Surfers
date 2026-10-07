import type { EventBus } from '../core/EventBus';
import type {
  BodyFrame,
  BodyThresholds,
  GameEvents,
  PoseDebugInfo,
  PoseLandmarkPoint,
} from '../core/types';
import { BodyState } from '../vision/BodyState';
import { readSample } from '../vision/PoseFeatures';
import type { PoseProfile } from '../vision/PoseProfile';

const LIVE_HISTORY = 240;
const WIDTH = 300;
const PLOT_H = 44;

interface Plot {
  label: string;
  value: (f: BodyFrame) => number;
  min: number;
  max: number;
  threshold: (t: BodyThresholds) => number | null;
  color: string;
}

const PLOTS: Plot[] = [
  {
    label: 'foot lift',
    value: (f) => f.ankleLift,
    min: -0.05,
    max: 0.25,
    threshold: (t) => t.airLift,
    color: '#4fc3f7',
  },
  {
    label: 'hip lift',
    value: (f) => f.hipLift,
    min: -0.3,
    max: 0.3,
    threshold: (t) => t.hipJump,
    color: '#aed581',
  },
  {
    label: 'crouch depth',
    value: (f) => f.crouchDepth,
    min: -0.1,
    max: 0.5,
    threshold: (t) => t.crouch,
    color: '#ffb74d',
  },
  {
    label: 'star score',
    value: (f) => f.starScore,
    min: 0,
    max: 1.5,
    threshold: () => 1,
    color: '#ce93d8',
  },
];

interface RecordedFrame {
  t: number;
  landmarks: PoseLandmarkPoint[];
  world: PoseLandmarkPoint[];
}

interface Recording {
  version: 1;
  profile: PoseProfile | null;
  frames: RecordedFrame[];
}

/**
 * Live detector traces and timing. `?debug`, the backtick key, or the start
 * screen Debug button opens it. Record, replay, clear, and close are buttons
 * (mouse or pinch) as well as R, L, and C.
 */
export class DebugOverlay {
  private readonly panel: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly fileInput: HTMLInputElement;
  private readonly recordBtn: HTMLButtonElement;
  private readonly clearBtn: HTMLButtonElement;
  private readonly getProfile: () => PoseProfile | null;
  private visible: boolean;
  private info: PoseDebugInfo | null = null;
  private frames: BodyFrame[] = [];
  private thresholds: BodyThresholds | null = null;
  private recording: RecordedFrame[] | null = null;
  private recordingStartedAt = 0;
  private replay: { frames: BodyFrame[]; thresholds: BodyThresholds; summary: string } | null = null;
  private drawQueued = false;

  constructor(root: HTMLElement, bus: EventBus<GameEvents>, getProfile: () => PoseProfile | null) {
    this.getProfile = getProfile;
    this.visible = new URLSearchParams(window.location.search).has('debug');

    this.panel = document.createElement('div');
    this.panel.className = 'debug-overlay';
    this.textEl = document.createElement('pre');
    this.canvas = document.createElement('canvas');
    this.canvas.width = WIDTH;
    this.canvas.height = PLOTS.length * PLOT_H;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D context for debug overlay');
    this.ctx = ctx;
    const actions = document.createElement('div');
    actions.className = 'debug-actions';
    this.recordBtn = actionButton('Record', () => this.toggleRecording());
    const replayBtn = actionButton('Replay', () => this.fileInput.click());
    this.clearBtn = actionButton('Clear', () => {
      this.replay = null;
      this.syncButtons();
      this.queueDraw();
    });
    const closeBtn = actionButton('Close', () => this.setVisible(false));
    actions.append(this.recordBtn, replayBtn, this.clearBtn, closeBtn);
    this.panel.append(actions, this.textEl, this.canvas);
    this.panel.hidden = !this.visible;
    root.appendChild(this.panel);

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'application/json';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', () => void this.loadReplay());
    root.appendChild(this.fileInput);

    this.syncButtons();
    window.addEventListener('keydown', (event) => this.onKey(event));
    bus.on('poseDebug', (info) => this.onDebug(info));
    bus.on('poseFrame', ({ landmarks, world, t }) => {
      this.recording?.push({ t, landmarks, world });
    });
    this.queueDraw();
  }

  /** Start screen Debug button. */
  show(): void {
    this.setVisible(true);
  }

  private setVisible(visible: boolean): void {
    this.visible = visible;
    this.panel.hidden = !visible;
    this.queueDraw();
  }

  private toggleRecording(): void {
    if (this.recording) this.stopRecording();
    else {
      this.recording = [];
      this.recordingStartedAt = performance.now();
    }
    this.syncButtons();
    this.queueDraw();
  }

  private syncButtons(): void {
    this.recordBtn.textContent = this.recording ? 'Save' : 'Record';
    this.clearBtn.disabled = !this.replay;
  }

  private onKey(event: KeyboardEvent): void {
    if (event.repeat) return;
    if (event.code === 'Backquote') {
      this.setVisible(!this.visible);
      return;
    }
    if (!this.visible) return;
    if (event.code === 'KeyR') this.toggleRecording();
    else if (event.code === 'KeyL') this.fileInput.click();
    else if (event.code === 'KeyC' && this.replay) {
      this.replay = null;
      this.syncButtons();
      this.queueDraw();
    }
  }

  private onDebug(info: PoseDebugInfo): void {
    this.info = info;
    if (info.body) {
      this.frames.push(info.body);
      if (this.frames.length > LIVE_HISTORY) this.frames.shift();
    }
    if (info.thresholds) this.thresholds = info.thresholds;
    this.queueDraw();
  }

  private queueDraw(): void {
    if (!this.visible || this.drawQueued) return;
    this.drawQueued = true;
    requestAnimationFrame(() => {
      this.drawQueued = false;
      this.draw();
    });
  }

  private draw(): void {
    const lines: string[] = [];
    const i = this.info;
    if (i) {
      lines.push(`${i.mode} · ${i.model} · ${i.delegate}`);
      lines.push(
        `cam ${i.cameraFps}fps · pose ${i.poseFps}fps · infer ${i.inferenceMs.toFixed(0)}ms · hand ${i.handMs.toFixed(0)}ms`,
      );
      lines.push(
        `capture→result ${i.latencyMs.toFixed(0)}ms · jump ${
          i.lastJumpLatencyMs === null ? '–' : `${i.lastJumpLatencyMs.toFixed(0)}ms`
        }`,
      );
      const b = i.body;
      if (b) {
        const flags = [
          b.airborne ? 'AIR' : '',
          b.crouching ? 'CROUCH' : '',
          b.running ? 'RUN' : '',
          b.starOk ? 'STAR' : '',
        ].filter(Boolean);
        lines.push(`${b.valid ? flags.join(' ') || 'standing' : 'no body'} · lane ${b.lane}`);
      } else {
        lines.push('detection off (start a motion run)');
      }
    } else {
      lines.push('waiting for pose…');
    }
    if (this.recording) {
      const secs = (performance.now() - this.recordingStartedAt) / 1000;
      lines.push(`● REC ${secs.toFixed(0)}s (${this.recording.length} frames)`);
    }
    if (this.replay) lines.push(this.replay.summary);
    this.syncButtons();
    this.textEl.textContent = lines.join('\n');

    const frames = this.replay?.frames ?? this.frames;
    const thresholds = this.replay?.thresholds ?? this.thresholds;
    this.drawPlots(frames, thresholds);
  }

  private drawPlots(frames: BodyFrame[], thresholds: BodyThresholds | null): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const n = frames.length;
    if (n < 2) return;
    const xAt = (idx: number) => (idx / (n - 1)) * WIDTH;

    PLOTS.forEach((plot, p) => {
      const top = p * PLOT_H;
      const yAt = (v: number) => {
        const k = (Math.max(plot.min, Math.min(plot.max, v)) - plot.min) / (plot.max - plot.min);
        return top + PLOT_H - 2 - k * (PLOT_H - 4);
      };

      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(0, top, WIDTH, PLOT_H - 1);

      for (let idx = 0; idx < n; idx++) {
        const f = frames[idx]!;
        if (!f.airborne && !f.crouching) continue;
        ctx.fillStyle = f.airborne ? 'rgba(79, 195, 247, 0.18)' : 'rgba(255, 183, 77, 0.18)';
        ctx.fillRect(xAt(idx), top, Math.max(1, WIDTH / n), PLOT_H - 1);
      }

      const thr = thresholds ? plot.threshold(thresholds) : null;
      if (thr !== null) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(0, yAt(thr));
        ctx.lineTo(WIDTH, yAt(thr));
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.strokeStyle = plot.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      frames.forEach((f, idx) => {
        const y = yAt(plot.value(f));
        if (idx === 0) ctx.moveTo(xAt(idx), y);
        else ctx.lineTo(xAt(idx), y);
      });
      ctx.stroke();

      for (let idx = 0; idx < n; idx++) {
        const f = frames[idx]!;
        if (!f.jumped && !f.starJumped) continue;
        ctx.fillStyle = f.starJumped ? '#e040fb' : '#69f0ae';
        ctx.fillRect(xAt(idx) - 1, top, 2, PLOT_H - 1);
      }

      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.font = '10px monospace';
      ctx.fillText(plot.label, 4, top + 11);
    });
  }

  private stopRecording(): void {
    const frames = this.recording ?? [];
    this.recording = null;
    this.syncButtons();
    if (frames.length === 0) return;
    const data: Recording = { version: 1, profile: this.getProfile(), frames };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pose-session-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private async loadReplay(): Promise<void> {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = '';
    if (!file) return;
    try {
      const rec = JSON.parse(await file.text()) as Recording;
      const profile = rec.profile ?? this.getProfile();
      if (!profile || !Array.isArray(rec.frames)) {
        this.replay = null;
        this.syncButtons();
        this.textEl.textContent = 'Replay needs a recording with a profile, or a saved calibration.';
        return;
      }
      this.replay = replayRecording(rec.frames, profile);
      this.syncButtons();
      this.queueDraw();
    } catch (error) {
      console.warn('[debug] replay failed:', error);
    }
  }
}

/** Runs a recorded session through BodyState with the given profile. */
export function replayRecording(
  recorded: RecordedFrame[],
  profile: PoseProfile,
): { frames: BodyFrame[]; thresholds: BodyThresholds; summary: string } {
  const body = new BodyState(profile);
  const frames: BodyFrame[] = [];
  let jumps = 0;
  let feetJumps = 0;
  let hipJumps = 0;
  let bothJumps = 0;
  let starJumps = 0;
  let crouches = 0;
  let airMs = 0;
  for (const r of recorded) {
    const sample = r.landmarks.length > 0 ? readSample(r.landmarks, r.world ?? []) : null;
    const f = body.update(sample, r.t);
    frames.push(f);
    if (f.jumped) {
      jumps += 1;
      if (f.jumpCue === 'feet') feetJumps += 1;
      else if (f.jumpCue === 'hips') hipJumps += 1;
      else if (f.jumpCue === 'both') bothJumps += 1;
    }
    if (f.starJumped) starJumps += 1;
    if (f.crouchPhase) crouches += 1;
    if (f.airPhase) airMs += f.airPhase.durationMs;
  }
  const first = recorded[0]?.t ?? 0;
  const last = recorded[recorded.length - 1]?.t ?? 0;
  const summary = `replay ${recorded.length}f ${((last - first) / 1000).toFixed(1)}s · jumps ${jumps} (feet ${feetJumps} · hips ${hipJumps} · both ${bothJumps}) · star ${starJumps} · crouch ${crouches} · air ${(airMs / 1000).toFixed(1)}s`;
  return { frames, thresholds: body.getThresholds(), summary };
}

function actionButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'debug-btn';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}
