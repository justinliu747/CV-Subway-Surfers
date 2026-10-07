import { DrawingUtils, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { PoseLandmarkPoint } from '../core/types';

export class SkeletonOverlay {
  private readonly canvas: HTMLCanvasElement;
  private readonly video: HTMLVideoElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly drawing: DrawingUtils;
  private visible = false;

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

  draw(landmarks: PoseLandmarkPoint[]): void {
    if (!this.visible) return;
    this.syncSize();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
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

  private syncSize(): void {
    // Landmarks are in the upright frame: sensor height × sensor width.
    const width = this.video.videoHeight || this.video.clientHeight || 480;
    const height = this.video.videoWidth || this.video.clientWidth || 640;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }
}
