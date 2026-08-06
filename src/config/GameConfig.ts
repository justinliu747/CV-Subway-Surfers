export const TRACK = { LANE_COUNT: 3, LANE_WIDTH: 2.0, LENGTH: 240, RUNG_SPACING: 8 } as const;

export const PLAYER = {
  RADIUS: 0.4,
  HALF_HEIGHT: 0.5, // capsule centre rests at RADIUS + HALF_HEIGHT = 0.9
  START_Y: 0.9,
  DUCK_HALF_HEIGHT: 0.15,
  DUCK_MS: 600,
  JUMP_VELOCITY: 9.5, // impulse = JUMP_VELOCITY * body.mass(); apex ~1.33m above start
  LANE_GAIN: 9, // proportional gain toward target lane centre
  LANE_MAX_SPEED: 12,
  DUCK_VISUAL_SCALE_Y: 0.55, // mesh Y scale while ducked
  DUCK_VISUAL_LERP_SPEED: 12, // how fast the visual squash approaches target
} as const;

export const RUN = { START_SPEED: 14, ACCEL: 0.25, MAX_SPEED: 32 } as const;

export const PHYSICS = {
  GRAVITY_Y: -34, // exaggerated on purpose; real gravity feels floaty in a runner
  FIXED_DT: 1 / 60,
  MAX_STEPS_PER_FRAME: 5,
  MAX_FRAME_DT: 0.1, // clamp before feeding the accumulator
  GROUND_RAY_SKIN: 0.12,
} as const;

export const OBSTACLES = {
  POOL_SIZE: 12,
  SPAWN_Z: -70,
  DESPAWN_Z: 12,
  MIN_GAP: 18,
  MAX_GAP: 30,
  FIRST_GAP: 8, // short gap so the first obstacle appears quickly after reset
  HIGH: { w: 0.9, h: 1.0, d: 0.8, centreY: 0.5 }, // jump over; apex clears it
  LOW: { w: 1.6, h: 0.5, d: 0.8, centreY: 1.75 }, // duck under; hangs above a ducked capsule
} as const;

export const VISION = {
  WASM_BASE: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm',
  MODEL_URL:
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  HAND_MODEL_URL:
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  MIN_VISIBILITY: 0.6,
  JUMP_RATIO: 0.18, // fallback / clamp reference: shoulder rise as a fraction of torso height
  DUCK_RATIO: 0.16, // fallback / clamp reference: shoulder drop as a fraction of torso height
  RELEASE_FACTOR: 0.6, // must fall back under ratio * this before re-firing
  COOLDOWN_MS: 350,
  LANE_SMOOTHING: 0.35, // EMA alpha for continuous lane signal (higher = snappier)
} as const;

/** Menu hand-cursor / pinch-click (never active during RUNNING). */
export const HAND_UI = {
  /** Fallback scale-normalized pinch ratio (tipDistance / wrist→middleMCP). */
  PINCH_RATIO_CLOSE: 0.35,
  PINCH_RATIO_OPEN: 0.55,
  PINCH_HOLD_MS: 250, // hold duration to commit corner save / button click
  CLICK_COOLDOWN_MS: 500, // ignore further commits after a click
  FRAMING_FRAMES: 20, // consecutive frames with a visible hand
  CORNER_SAMPLE_FRAMES: 8, // average wrist samples while pinch is held
  PINCH_CYCLES: 3, // open/close pairs during pinch calibration
  PINCH_SAMPLE_MS: 1500, // dwell while user holds pinch or open pose
  PINCH_MIN_CONTRAST: 0.08, // min (openMean - closedMean) to accept calib
  PINCH_CLOSE_LERP: 0.35, // closed→open blend for close threshold
  PINCH_OPEN_LERP: 0.55, // closed→open blend for open threshold
  HAND_SCALE_MIN: 0.02, // floor for wrist→MCP scale
  MIN_QUAD_AREA: 0.02, // min parallelogram area in mirrored camera space
  MIRROR_X: true, // selfie preview is CSS-mirrored; store/map in display space
  CURSOR_ALPHA_SLOW: 0.18, // EMA alpha for tiny motion / shake
  CURSOR_ALPHA_FAST: 0.85, // EMA alpha for large flicks
  CURSOR_SPEED_LO: 0.004, // display-space delta → slow alpha
  CURSOR_SPEED_HI: 0.04, // display-space delta → fast alpha
  PROFILE_STORAGE_KEY: 'subway-surfers-hand-profile-v1',
  PROFILE_VERSION: 3,
} as const;

/** MediaPipe Hand landmark indices used by HandTracker. */
export const HAND_LANDMARK = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
} as const;

export const CALIBRATION = {
  FRAMING_FRAMES: 30,
  NEUTRAL_FRAMES: 45,
  COUNTDOWN_MS: 3000,
  CAPTURE_MS: 2500,
  TRIGGER_FRACTION: 0.55,
  NOISE_MULTIPLIER: 4,
  MIN_PEAK_OVER_NOISE: 3,
  THRESHOLD_FLOOR_FACTOR: 0.4,
  THRESHOLD_CEILING_FACTOR: 1.2,
  MIN_LANE_SEPARATION: 0.08, // min |ΔlaneSignal| between adjacent captured lanes
  VALIDATE_NEUTRAL_MS: 600, // must hold neutral before enabling jump/duck detection
  VALIDATE_LANE_DWELL_MS: 700, // must stay in target lane this long to pass
  VALIDATE_SUCCESS_PAUSE_MS: 500, // brief pause after each validate success
  PROFILE_STORAGE_KEY: 'subway-surfers-pose-profile-v1',
  PROFILE_VERSION: 2,
} as const;

export const KEYS = {
  LEFT: ['ArrowLeft', 'KeyA'],
  RIGHT: ['ArrowRight', 'KeyD'],
  JUMP: ['ArrowUp', 'KeyW', 'Space'],
  DUCK: ['ArrowDown', 'KeyS'],
} as const;

/** BlazePose landmark indices used by PoseTracker. */
export const LANDMARK = {
  NOSE: 0,
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_HIP: 23,
  R_HIP: 24,
} as const;
