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
  | 'jump'
  | 'duck'
  | 'hop_left'
  | 'hop_right'
  | 'validate'
  | 'done'
  | 'rejected';

export type CalibrationUpdate =
  | {
      phase: 'framing' | 'neutral' | 'countdown' | 'capture' | 'validate' | 'done' | 'rejected';
      step: CalibrationStepId;
      instruction: string;
      progress: number; // 0..1
      countdown?: number;
      deviation?: number;
      peak?: number;
      validated?: Partial<Record<'JUMP' | 'DUCK' | 'MOVE_LEFT' | 'MOVE_RIGHT', boolean>>;
    };

export interface GameEvents {
  gesture: GestureEvent;
  poseFrame: {
    landmarks: PoseLandmarkPoint[];
    sample: PoseSample | null;
  };
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
