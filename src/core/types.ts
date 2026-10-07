/** Keyboard actions. Pose input uses the dedicated pose* events instead. */
export type Gesture = 'JUMP' | 'DUCK' | 'MOVE_LEFT' | 'MOVE_RIGHT' | 'STAR_JUMP';
export type GameState =
  | 'BOOTING'
  | 'START_MENU'
  | 'CALIBRATING'
  | 'HAND_CALIBRATING'
  | 'RUNNING'
  | 'CATCHING'
  | 'GAME_OVER';
export type Lane = -1 | 0 | 1;
export type ObstacleKind = 'high' | 'low' | 'poseStar';

export interface GestureEvent {
  gesture: Gesture;
  source: 'keyboard';
  at: number;
}

/** Star shape from world landmarks (meters), so it holds at any distance. */
export interface StarGeometry {
  /** Arm elevation from the torso, degrees. Arms down ≈ 10°, T-pose ≈ 90°, star ≈ 130°. */
  armL: number;
  armR: number;
  /** Elbow angle, degrees. Straight arm = 180°. */
  elbowL: number;
  elbowR: number;
  /** Ankle distance ÷ hip width. */
  spread: number;
}

/** One frame of image-space measurements (upright frame, 0..1, y grows downward). */
export interface PoseSample {
  shoulderMidY: number;
  shoulderMidX: number;
  noseX: number;
  noseY: number;
  hipMidY: number | null;
  hipsVisible: boolean;
  ankleLY: number | null;
  ankleRY: number | null;
  /** Mean ankle Y when both ankles visible; else null. */
  ankleMidY: number | null;
  /** Mean knee Y when both knees visible; else null. */
  kneeMidY: number | null;
  anklesVisible: boolean;
  /**
   * Lowest visible point of each foot (ankle, heel, or toe). Null when that
   * foot has no point this frame — the previous value is not reused.
   */
  footLY: number | null;
  footRY: number | null;
  /** Both feet have a point at normal visibility this frame. */
  feetConfident: boolean;
  star: StarGeometry | null;
}

/** Stats for one completed time in the air. */
export interface AirPhase {
  /** Peak foot lift. 0 when the feet were never visible during the jump. */
  peakLift: number;
  peakHip: number;
  durationMs: number;
  /** Best star shape seen while airborne, by the current star thresholds. */
  starBest: StarGeometry | null;
  starFrames: number;
}

export interface CrouchPhase {
  peakDepth: number;
  durationMs: number;
}

/** Which signal started a jump. */
export type JumpCue = 'feet' | 'hips' | 'both';

/** Continuous body state for one frame. Lengths are fractions of standing leg length. */
export interface BodyFrame {
  t: number;
  valid: boolean;
  hipLift: number;
  /** Hip vertical speed, leg lengths per second, + up. */
  hipVel: number;
  /** Lower of the two feet above the floor line. 0 when a foot is unknown this frame. */
  ankleLift: number;
  /** Head drop below standing. */
  crouchDepth: number;
  airborne: boolean;
  crouching: boolean;
  runIntensity: number;
  running: boolean;
  star: StarGeometry | null;
  starOk: boolean;
  /** min over star margins; 1 = exactly at threshold. */
  starScore: number;
  lane: Lane;
  laneSignal: number;
  /** Edges for this frame. */
  jumped: boolean;
  /** Set on the frame `jumped` is true. */
  jumpCue: JumpCue | null;
  landed: boolean;
  starJumped: boolean;
  airPhase: AirPhase | null;
  crouchPhase: CrouchPhase | null;
}

export interface BodyThresholds {
  airLift: number;
  /** Hips above standing by this much, after an upward push, counts as airborne. */
  hipJump: number;
  crouch: number;
  runCadence: number;
  starArm: number;
  starSpread: number;
}

export interface PoseDebugInfo {
  mode: 'worker' | 'main';
  model: string;
  delegate: string;
  cameraFps: number;
  poseFps: number;
  inferenceMs: number;
  /** Wrist-crop hand model time for this frame. 0 when hand controls are off. */
  handMs: number;
  /** Camera capture → result handled, ms. */
  latencyMs: number;
  lastJumpLatencyMs: number | null;
  body: BodyFrame | null;
  thresholds: BodyThresholds | null;
}

export interface PoseLandmarkPoint {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export type CalibrationStepId =
  | 'stand'
  | 'lane_left'
  | 'lane_right'
  | 'jump'
  | 'duck'
  | 'run'
  | 'star_jump'
  | 'done';

export type CalibrationFeedback = {
  kind: 'hold' | 'reps';
  /** Hold: milliseconds accumulated. Reps: reps completed. */
  value: number;
  /** Hold: milliseconds required. Reps: reps required. */
  target: number;
};

export type CalibrationUpdate = {
  step: CalibrationStepId;
  /** 0-based index of the current step. Equal to stepTotal once done. */
  stepIndex: number;
  stepTotal: number;
  instruction: string;
  feedback: CalibrationFeedback;
};

export interface Vec2 {
  x: number;
  y: number;
}

export type HandCalibrationStep = 'raise' | 'pinch' | 'done';

export type HandCalibrationUpdate = {
  step: HandCalibrationStep;
  stepIndex: number;
  stepTotal: number;
  instruction: string;
  feedback: CalibrationFeedback;
};

/** The player's own hand (body side), not the mirrored screen side. */
export type Handedness = 'Left' | 'Right';

export interface HandFrameEvent {
  /** Cursor in the shoulder-anchored pointing area, mirrored display space (0..1). Null with the arm down. */
  cursor: Vec2 | null;
  /** The hand the cursor follows. */
  side: Handedness | null;
  /** Which wrists are above their elbow. Used to pick a hand. */
  raised: Record<Handedness, boolean>;
  /** Thumb–index tip distance ÷ wrist–middle-knuckle distance. Null when the hand is not found. */
  pinchRatio: number | null;
  pinching: boolean;
  pinchHeld: boolean;
  /** True on the frame the hold threshold is first crossed. */
  pinchCommit: boolean;
  pinchProgress: number; // 0..1 toward hold
}

export interface HandPointerEvent {
  /** CSS pixels inside the portrait #app. */
  x: number;
  y: number;
  /** Position in the pointing area, 0..1. */
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
    world: PoseLandmarkPoint[];
    sample: PoseSample | null;
    /** Hand landmarks from the same frame, or null when hand controls are off. */
    hand: PoseLandmarkPoint[] | null;
    /** performance.now() timeline. */
    t: number;
  };
  poseLane: { lane: Lane };
  poseRun: { active: boolean; intensity: number };
  /** Takeoff. Fires once per jump. */
  poseJump: { at: number };
  /** Every frame while detection is on. depth01 drives the avatar squash. */
  poseCrouch: { active: boolean; depth01: number };
  /** Airborne with a star shape. Fires once per jump. */
  poseStarJump: { at: number };
  poseDebug: PoseDebugInfo;
  calibration: CalibrationUpdate;
  handFrame: HandFrameEvent;
  handPointer: HandPointerEvent;
  handCalibration: HandCalibrationUpdate;
  state: { from: GameState; to: GameState };
  score: { value: number };
  coin: { value: number; total: number };
  status: { text: string };
}

export interface IGestureSource {
  readonly name: 'pose' | 'keyboard';
  start(): Promise<void>;
  stop(): void;
}
