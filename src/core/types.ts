export type Gesture = 'JUMP' | 'DUCK' | 'MOVE_LEFT' | 'MOVE_RIGHT' | 'NEUTRAL';
export type GameState =
  | 'BOOTING'
  | 'START_MENU'
  | 'CALIBRATING'
  | 'HAND_CALIBRATING'
  | 'RUNNING'
  | 'GAME_OVER';
export type Lane = -1 | 0 | 1;
export type ObstacleKind = 'high' | 'low'; // 'high' = jump over, 'low' = duck under

export interface GestureEvent {
  gesture: Gesture;
  source: 'pose' | 'keyboard';
  at: number;
}

export interface PoseSample {
  shoulderMidY: number;
  shoulderMidX: number;
  hipMidY: number | null;
  shoulderWidth: number;
  noseX: number;
  hipsVisible: boolean;
}

export interface PoseLandmarkPoint {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export type CalibrationStepId =
  | 'framing'
  | 'neutral'
  | 'lane_left'
  | 'lane_center'
  | 'lane_right'
  | 'jump'
  | 'duck'
  | 'validate'
  | 'done'
  | 'rejected';

export type ValidateTarget = 'LANE_LEFT' | 'LANE_CENTER' | 'LANE_RIGHT' | 'JUMP' | 'DUCK';

export interface LaneGuides {
  /** Calibrated (or provisional) image-space X for the left lane centre (0..1). */
  leftX: number;
  /** Calibrated (or provisional) image-space X for the center lane centre (0..1). */
  centerX: number;
  /** Calibrated (or provisional) image-space X for the right lane centre (0..1). */
  rightX: number;
}

export type CalibrationUpdate = {
  phase: 'framing' | 'neutral' | 'countdown' | 'capture' | 'validate' | 'done' | 'rejected';
  step: CalibrationStepId;
  instruction: string;
  progress: number; // 0..1
  countdown?: number;
  deviation?: number;
  peak?: number;
  laneGuides?: LaneGuides;
  highlightLane?: Lane | null;
  validateTarget?: ValidateTarget;
  validateIndex?: number;
  validateTotal?: number;
  validateSuccess?: boolean;
};

export type HandCornerId = 'tl' | 'tr' | 'br' | 'bl';

export interface Vec2 {
  x: number;
  y: number;
}

export interface HandCorners {
  tl: Vec2;
  tr: Vec2;
  br: Vec2;
  bl: Vec2;
}

export type HandCalibrationPhase =
  | 'framing'
  | 'pinch'
  | 'open'
  | 'corner'
  | 'rejected'
  | 'done';

export type HandCalibrationUpdate = {
  phase: HandCalibrationPhase;
  corner?: HandCornerId;
  cornerIndex?: number; // 0..3
  instruction: string;
  progress: number; // 0..1
  pinchProgress?: number; // 0..1 hold progress for current pinch / sample dwell
  pinchCycle?: number; // 1..PINCH_CYCLES
  pinchCyclesTotal?: number;
  captured?: Partial<Record<HandCornerId, boolean>>;
};

export type Handedness = 'Left' | 'Right';

export type PinchPhase = 'open' | 'closing' | 'held' | 'released';

export interface HandFrameEvent {
  landmarks: PoseLandmarkPoint[];
  /** Wrist position in mirrored display space (0..1) when a hand is visible. */
  cursor: Vec2 | null;
  handedness: Handedness | null;
  /** Raw tip distance (display space). */
  pinchDistance: number | null;
  /** tipDistance / handScale — primary pinch metric. */
  pinchRatio: number | null;
  pinching: boolean;
  pinchHeld: boolean;
  /** True on the frame the hold threshold is first crossed. */
  pinchCommit: boolean;
  pinchProgress: number; // 0..1 toward hold
}

export interface HandPointerEvent {
  /** Screen CSS pixels. */
  x: number;
  y: number;
  /** UV in calibrated interaction area (may be outside 0..1 if off-quad). */
  u: number;
  v: number;
  pinching: boolean;
  pinchHeld: boolean;
  pinchCommit: boolean;
  pinchProgress: number;
  visible: boolean;
}

export interface GameEvents {
  gesture: GestureEvent;
  poseFrame: {
    landmarks: PoseLandmarkPoint[];
    sample: PoseSample | null;
  };
  poseLane: { lane: Lane };
  calibration: CalibrationUpdate;
  handFrame: HandFrameEvent;
  handPointer: HandPointerEvent;
  handCalibration: HandCalibrationUpdate;
  state: { from: GameState; to: GameState };
  score: { value: number };
  status: { text: string };
}

export interface IGestureSource {
  readonly name: 'pose' | 'keyboard';
  start(): Promise<void>;
  stop(): void;
}
