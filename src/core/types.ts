export type Gesture = 'JUMP' | 'DUCK' | 'MOVE_LEFT' | 'MOVE_RIGHT' | 'NEUTRAL';
export type GameState = 'BOOTING' | 'START_MENU' | 'CALIBRATING' | 'RUNNING' | 'GAME_OVER';
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

export interface GameEvents {
  gesture: GestureEvent;
  poseFrame: {
    landmarks: PoseLandmarkPoint[];
    sample: PoseSample | null;
  };
  poseLane: { lane: Lane };
  calibration: CalibrationUpdate;
  state: { from: GameState; to: GameState };
  score: { value: number };
  status: { text: string };
}

export interface IGestureSource {
  readonly name: 'pose' | 'keyboard';
  start(): Promise<void>;
  stop(): void;
}
