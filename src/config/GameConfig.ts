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
  SPAWN_Z: -140,
  DESPAWN_Z: 12,
  MIN_GAP: 18,
  MAX_GAP: 30,
  HIGH: { w: 0.9, h: 1.0, d: 0.8, centreY: 0.5 }, // jump over; apex clears it
  LOW: { w: 1.6, h: 0.5, d: 0.8, centreY: 1.75 }, // duck under; hangs above a ducked capsule
} as const;

export const VISION = {
  WASM_BASE: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm',
  MODEL_URL:
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  MIN_VISIBILITY: 0.6,
  JUMP_RATIO: 0.18, // fallback / clamp reference: shoulder rise as a fraction of torso height
  DUCK_RATIO: 0.16, // fallback / clamp reference: shoulder drop as a fraction of torso height
  LANE_RATIO: 0.35, // fallback / clamp reference: lateral offset as a fraction of shoulder width
  RELEASE_FACTOR: 0.6, // must fall back under ratio * this before re-firing
  COOLDOWN_MS: 350,
  MIRROR: true, // default until auto-detected during guided calibration
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
  PROFILE_STORAGE_KEY: 'subway-surfers-pose-profile-v1',
  PROFILE_VERSION: 1,
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
