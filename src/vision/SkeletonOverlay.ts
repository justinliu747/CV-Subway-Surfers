import { DrawingUtils, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { Lane, LaneGuides, PoseLandmarkPoint } from '../core/types';

interface LaneRef {
  lane: Lane;
  x: number;
  label: string;
}

export class SkeletonOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly video: HTMLVideoElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly drawing: DrawingUtils;
  private visible = false;
  private laneGuides: LaneGuides | null = null;
  private highlightLane: Lane | null = null;

  constructor(canvas: HTMLCanvasElement, video: HTMLVideoElement) {
    this.canvas = canvas;
    this.video = video;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not get 2D context for skeleton canvas');
    }
    this.ctx = ctx;
    this.drawing = new DrawingUtils(ctx);

    this.video.addEventListener('loadedmetadata', () => this.syncSize());
    window.addEventListener('resize', () => this.syncSize());
    this.syncSize();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.canvas.style.display = visible ? 'block' : 'none';
    if (!visible) this.clear();
  }

  setLaneGuides(guides: LaneGuides | null, highlightLane: Lane | null = null): void {
    this.laneGuides = guides;
    this.highlightLane = highlightLane;
  }

  draw(landmarks: PoseLandmarkPoint[]): void {
    if (!this.visible) return;
    this.syncSize();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.laneGuides) {
      this.drawLaneGuides(this.laneGuides, this.highlightLane);
    }

    if (landmarks.length === 0) return;

    const points = landmarks as NormalizedLandmark[];
    this.drawing.drawConnectors(points, PoseLandmarker.POSE_CONNECTIONS, {
      color: '#8da9c4',
      lineWidth: 3,
    });
    this.drawing.drawLandmarks(points, {
      color: '#ffc857',
      fillColor: '#ffc857',
      radius: 4,
      lineWidth: 1,
    });
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private drawLaneGuides(guides: LaneGuides, highlight: Lane | null): void {
    const w = this.canvas.width;
    const h = this.canvas.height;

    const refs: LaneRef[] = (
      [
        { lane: -1 as Lane, x: guides.leftX, label: 'LEFT' },
        { lane: 0 as Lane, x: guides.centerX, label: 'CENTER' },
        { lane: 1 as Lane, x: guides.rightX, label: 'RIGHT' },
      ] satisfies LaneRef[]
    ).sort((a, b) => a.x - b.x);

    const edges = [0, (refs[0].x + refs[1].x) * 0.5, (refs[1].x + refs[2].x) * 0.5, 1];

    // Highlight active lane cell (image space; CSS scaleX(-1) mirrors for selfie view).
    if (highlight !== null) {
      const idx = refs.findIndex((r) => r.lane === highlight);
      if (idx >= 0) {
        const x0 = edges[idx]! * w;
        const x1 = edges[idx + 1]! * w;
        this.ctx.fillStyle = 'rgba(255, 200, 87, 0.18)';
        this.ctx.fillRect(x0, 0, x1 - x0, h);
      }
    }

    // Dashed divider lines between cells.
    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([8, 6]);
    for (let i = 1; i <= 2; i++) {
      const x = edges[i]! * w;
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, h);
      this.ctx.stroke();
    }
    this.ctx.restore();

    // Labels at each lane centre.
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    this.ctx.font = `bold ${Math.max(12, Math.round(h * 0.045))}px sans-serif`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'top';
    const labelY = 8;
    for (const ref of refs) {
      this.ctx.fillText(ref.label, ref.x * w, labelY);
    }
  }

  private syncSize(): void {
    const width = this.video.videoWidth || this.video.clientWidth || 640;
    const height = this.video.videoHeight || this.video.clientHeight || 480;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }
}
