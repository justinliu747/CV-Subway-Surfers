export const TRACK = { LANE_COUNT: 3, LANE_WIDTH: 2.0, LENGTH: 240, RUNG_SPACING: 8 } as const;

export const PLAYER = {
  RADIUS: 0.4,
  HALF_HEIGHT: 0.5, // capsule centre rests at RADIUS + HALF_HEIGHT = 0.9
  START_Y: 0.9,
  DUCK_HALF_HEIGHT: 0.15,
  DUCK_MS: 600,
  JUMP_VELOCITY: 9.5, // impulse = JUMP_VELOCITY * body.mass(); apex ~1.33m above start
  LANE_GAIN: 14, // proportional gain toward target lane centre
  LANE_MAX_SPEED: 18,
  DUCK_VISUAL_SCALE_Y: 0.55, // mesh Y scale while ducked
  DUCK_VISUAL_LERP_SPEED: 12, // how fast the visual squash approaches target
} as const;

export const RUN = { START_SPEED: 14, ACCEL: 0.25, MAX_SPEED: 32 } as const;

export const SCORE = {
  STORAGE_KEY: 'subway-surfers-high-score-v1',
} as const;

export const COIN = {
  POOL_SIZE: 24,
  POINTS: 10,
  RADIUS: 0.28,
  CENTRE_Y: 1.1,
  SPAWN_Z: -70,
  DESPAWN_Z: 12,
  /** Distance behind an obstacle pattern before placing a coin line. */
  PATTERN_OFFSET: 4,
  /** Spacing along Z for multi-coin lines. */
  LINE_SPACING: 2.2,
} as const;

export const PHYSICS = {
  GRAVITY_Y: -34, // exaggerated on purpose; real gravity feels floaty in a runner
  FIXED_DT: 1 / 60,
  MAX_STEPS_PER_FRAME: 5,
  MAX_FRAME_DT: 0.1, // clamp before feeding the accumulator
  GROUND_RAY_SKIN: 0.12,
} as const;

export const OBSTACLES = {
  POOL_SIZE: 36,
  SPAWN_Z: -70,
  DESPAWN_Z: 12,
  /** Easy early gaps (distance units). */
  MIN_GAP_EASY: 16,
  MAX_GAP_EASY: 26,
  /** Hard late gaps. */
  MIN_GAP_HARD: 9,
  MAX_GAP_HARD: 14,
  FIRST_GAP: 8, // short gap so the first obstacle appears quickly after reset
  /** Distance traveled at which difficulty reaches max (0..1 lerp). */
  DIFFICULTY_DISTANCE: 900,
  /** Z offset between jump→duck combo pieces. */
  COMBO_Z_OFFSET: 5,
  HIGH: { w: 0.9, h: 1.0, d: 0.8, centreY: 0.5 }, // jump over; apex clears it
  LOW: { w: 1.6, h: 0.5, d: 0.8, centreY: 1.75 }, // duck under; hangs above a ducked capsule
  /** Tall wall with pose cutout (player must match pose to pass). */
  POSE_GATE: { w: 1.8, h: 2.4, d: 0.45, centreY: 1.2 },
} as const;

/** Motion-only: stop running too long and a guard catches you. */
export const STAMINA = {
  IDLE_MS: 3000,
  SLOW_FACTOR: 0.35,
  CATCH_MS: 1000,
  /** How fast the idle bar refills while running (ms per second of run). */
  REFILL_RATE: 2.5,
} as const;

/** Star gate pass band. */
export const POSE_GATE = {
  /** Absolute Z band around the player where a star jump clears the gate early. */
  WINDOW_Z: 4.5,
} as const;

/**
 * Obstacle judgment windows (motion mode). A hit is held open for LATE_MS; it is
 * forgiven if the needed action happened within the EARLY window before the hit
 * or arrives during LATE_MS. This absorbs body and camera delay.
 */
export const JUDGE = {
  JUMP_EARLY_MS: 700,
  CROUCH_EARLY_MS: 350,
  STAR_EARLY_MS: 900,
  LATE_MS: 200,
  /** Jumps, crouches, and star jumps count as running for this long. */
  ACTIVITY_MS: 900,
} as const;

export const VISION = {
  WASM_BASE: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm',
  MODEL_URL:
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  /** Use with ?model=full to compare accuracy and inference time. */
  MODEL_URL_FULL:
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  HAND_MODEL_URL:
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  MIN_VISIBILITY: 0.6,
  /** Worker init longer than this falls back to main-thread inference. */
  WORKER_INIT_TIMEOUT_MS: 20000,
  /** EMA for ankle-height run cadence. */
  RUN_SMOOTHING: 0.35,
  /** Fallback run cadence threshold (torso-normalized ankle oscillation). */
  RUN_CADENCE_RATIO: 0.045,
} as const;

/**
 * Body-state detectors. Lengths are fractions of standing leg length (hip to
 * floor line); angles are degrees; spread is ankle distance ÷ hip width.
 */
export const BODY = {
  /** Both ankles above the floor line by this much = airborne. */
  AIR_LIFT_DEFAULT: 0.04,
  AIR_LIFT_MIN: 0.025,
  AIR_LIFT_MAX: 0.1,
  /** Airborne ends when the lower ankle drops under airLift × this. */
  AIR_RELEASE: 0.5,
  /** Hips may sit this far below standing and still count as airborne. */
  AIR_HIP_TOL: 0.04,
  /** Longer than this in the air is a tracking error, not a jump. */
  AIR_MAX_MS: 1500,
  /**
   * Hip cue: hips this far above standing, just after a clear upward speed.
   * Above normal standing sway. Calibration can only raise it.
   */
  HIP_JUMP_MIN: 0.06,
  HIP_JUMP_DEFAULT: 0.06,
  /** Upward hip speed (leg lengths / second) that arms the hip cue. */
  HIP_CUE_VEL: 1.1,
  /** The hip cue counts only this soon after that upward speed. */
  HIP_CUE_WINDOW_MS: 300,
  /** With the feet unknown, airborne ends once hip rise falls under hipJump × this. */
  HIP_RELEASE: 0.5,
  /** Ankle, heel, and toe points dimmer than this are ignored. Looser than body visibility. */
  FOOT_VISIBILITY: 0.3,
  /** Early takeoff: hips moving up this fast right after a dip. */
  TAKEOFF_EARLY: true,
  TAKEOFF_VEL: 1.1,
  TAKEOFF_DIP: 0.06,
  TAKEOFF_DIP_WINDOW_MS: 450,
  /** An early takeoff with no airborne frames re-arms after this. */
  TAKEOFF_CONFIRM_MS: 400,
  /** Grounded this long after landing before the next jump can fire. */
  JUMP_REARM_MS: 150,
  CROUCH_DEFAULT: 0.15,
  CROUCH_MIN: 0.08,
  CROUCH_MAX: 0.35,
  CROUCH_FRAMES: 2,
  /** Crouch ends when depth drops under threshold × this. */
  CROUCH_RELEASE: 0.6,
  /** Landing dip is ignored this long unless it is very deep. */
  LANDING_MS: 300,
  STAR_ARM_DEFAULT: 115,
  STAR_ARM_MIN: 100,
  STAR_ELBOW_MIN: 125,
  STAR_SPREAD_DEFAULT: 2.0,
  STAR_SPREAD_MIN: 1.6,
  /** Star shape on this many airborne frames = star jump. */
  STAR_JUMP_FRAMES: 2,
  /** Floor, head, and hip baselines follow slow drift (stepping closer or back). */
  BASELINE_TAU_MS: 1500,
  /** Lost tracking this long clears airborne and crouch. */
  LOST_RESET_MS: 400,
  /**
   * 1€ filter on vertical signals (normalized image units). The derivative
   * cutoff is high because hip speed drives the early takeoff.
   */
  FILTER_MIN_CUTOFF: 1.7,
  FILTER_BETA: 20,
  FILTER_D_CUTOFF: 6,
  LANE_MIN_CUTOFF: 1.2,
  LANE_BETA: 8,
  LANE_D_CUTOFF: 1.0,
} as const;

/**
 * Menu hand cursor and pinch-click (never active during RUNNING).
 * The cursor comes from the body tracker's wrist, inside a pointing area
 * anchored to the active shoulder and sized in shoulder widths, so it works at
 * full-body distance. Pinch runs the hand model on a crop around that wrist.
 */
export const HAND_UI = {
  /** Fallback pinch ratio (tip distance ÷ wrist→middle-knuckle). */
  PINCH_RATIO_CLOSE: 0.35,
  PINCH_RATIO_OPEN: 0.55,
  PINCH_HOLD_MS: 250, // hold duration to commit a button click
  CLICK_COOLDOWN_MS: 500, // ignore further commits after a click
  /** Setup: one raised hand held this long picks the menu hand. */
  RAISE_HOLD_MS: 600,
  /** Setup: pinch reps. A rep drops below CLOSE × open hand, then returns above OPEN × open hand. */
  PINCH_REPS: 2,
  PINCH_REP_CLOSE: 0.6,
  PINCH_REP_OPEN: 0.85,
  /** Your open hand is the highest ratio seen over this window. */
  PINCH_OPEN_WINDOW_MS: 1000,
  PINCH_MIN_CONTRAST: 0.08, // min (openMean - closedMean) to accept calib
  PINCH_CLOSE_LERP: 0.35, // closed→open blend for close threshold
  PINCH_OPEN_LERP: 0.55, // closed→open blend for open threshold
  HAND_SCALE_MIN: 0.02, // floor for wrist→knuckle scale (crop units)
  /** Pointing area, in shoulder widths: centered on the active shoulder horizontally. */
  ZONE_WIDTH: 2.4,
  ZONE_TOP: 1.1, // above the shoulder
  ZONE_HEIGHT: 2.0,
  /** Hand crop: side = shoulder width × this, centered past the wrist along the forearm. */
  CROP_SCALE: 1.4,
  CROP_REACH: 0.35,
  CROP_SIZE: 256,
  /**
   * 1€ filter on the cursor (0..1 units). The derivative cutoff is high so a
   * short move loosens the filter immediately instead of trailing the hand.
   */
  CURSOR_MIN_CUTOFF: 2.5,
  CURSOR_BETA: 4,
  CURSOR_D_CUTOFF: 4,
  MIRROR_X: true, // selfie preview is CSS-mirrored; map in display space
  PROFILE_STORAGE_KEY: 'subway-surfers-hand-profile-v1',
  PROFILE_VERSION: 5,
} as const;

/** MediaPipe Hand landmark indices used by HandTracker. */
export const HAND_LANDMARK = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
} as const;

export const CALIBRATION = {
  /** Steady shoulders required before the standing baseline is saved. */
  STILL_HOLD_MS: 1000,
  /** Max torso-normalized shoulder-Y stddev that still counts as standing still. */
  STILL_MAX_STD: 0.035,
  /** Steady lane position required after stepping far enough from center. */
  LANE_HOLD_MS: 500,
  /** Max lane-signal drift during the lane hold. */
  LANE_STEADY: 0.035,
  GESTURE_REPS: 2,
  /** Running, above the idle level, required to set the run threshold. */
  RUN_CAPTURE_MS: 2000,
  /** Smoothed cadence must clear idle by this factor. A stride is cyclic, not a peak. */
  RUN_IDLE_FACTOR: 1.6,
  /** Pause between steps that still counts as the same run. */
  RUN_GAP_MS: 450,
  /** How long a step can go unmet before its hint replaces the prompt. */
  HINT_AFTER_MS: 6000,
  /** Completed step stays on screen this long so the last rep or full bar is visible. */
  SUCCESS_BEAT_MS: 450,
  /** A jump rep must lift both feet at least this much, unless the hips clear hipJump. */
  JUMP_REP_MIN_LIFT: 0.04,
  /** airLift = this × smallest jump rep. */
  AIR_FROM_REP: 0.45,
  /** hipJump = this × smallest hip rise, and never under BODY.HIP_JUMP_MIN. */
  HIP_FROM_REP: 0.4,
  /** A duck rep must be held this long, so a jump wind-up does not count. */
  DUCK_HOLD_MS: 300,
  DUCK_REP_MIN_DEPTH: 0.12,
  /** crouch = this × shallowest duck rep. */
  CROUCH_FROM_REP: 0.5,
  STAR_ARM_FROM_REP: 0.85,
  STAR_SPREAD_FROM_REP: 0.8,
  /** Star spread must also beat standing spread by this factor. */
  STAR_SPREAD_OVER_STANDING: 1.3,
  /** Ankle noise floor multiplier for the airborne threshold. */
  NOISE_MULTIPLIER: 4,
  MIN_LANE_SEPARATION: 0.08, // min |ΔlaneSignal| between adjacent captured lanes
  PROFILE_STORAGE_KEY: 'subway-surfers-pose-profile-v1',
  PROFILE_VERSION: 7,
} as const;

export const KEYS = {
  LEFT: ['ArrowLeft', 'KeyA'],
  RIGHT: ['ArrowRight', 'KeyD'],
  JUMP: ['ArrowUp', 'KeyW', 'Space'],
  DUCK: ['ArrowDown', 'KeyS'],
  STAR_JUMP: ['KeyJ'],
} as const;

/** BlazePose landmark indices used by PoseTracker. */
export const LANDMARK = {
  NOSE: 0,
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_ELBOW: 13,
  R_ELBOW: 14,
  L_WRIST: 15,
  R_WRIST: 16,
  L_HIP: 23,
  R_HIP: 24,
  L_KNEE: 25,
  R_KNEE: 26,
  L_ANKLE: 27,
  R_ANKLE: 28,
  L_HEEL: 29,
  R_HEEL: 30,
  L_FOOT_INDEX: 31,
  R_FOOT_INDEX: 32,
} as const;
