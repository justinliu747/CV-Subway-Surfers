# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Body-state motion controls** — jump means both feet leave the floor (plus an early trigger on the push after a wind-up dip); duck is a held crouch with feet planted. A jump wind-up, a landing dip, and running in place no longer read as ducks or jumps.
- **Obstacle timing windows** — in motion mode a hit is held open briefly and forgiven if the needed jump, duck, or star jump lands in its window.
- **Debug overlay** (`?debug`, backtick, or the start-screen Debug button) — fps, pose and hand inference time, capture-to-event delay, live detector traces. Record / Save, Replay, Clear, and Close are buttons (mouse or pinch). R, L, and C still work. Replay reports whether each jump came from the feet, the hips, or both.
- **Pose inference worker** — MediaPipe runs in a module worker, with a main-thread fallback (`?mainthread`). `?model=full` switches to the full pose model.
- **Run-in-place stamina (motion)** — knee/ankle cadence tracking; idle bar drains when standing still; after 3s a guard catches you (game over). Jumps, ducks, and star jumps count as activity.
- **Star gates** — clear them with a star jump: arms up and out, feet wide, while airborne. Shape is measured as joint angles from world landmarks.
- **Pose calibration** — stand, step left, step right, jump, duck, run in place, star jump. Each step ends when the measurement is captured, using the same detectors as gameplay.
- **Keyboard star jump** — `J`. Keyboard mode auto-runs (no stamina bar).
- **Coin collection** — gold coins spawn in open lanes; each coin is worth 10 points (score is coin-based only).
- **High score** — persisted in localStorage (`subway-surfers-high-score-v1`); shown on start screen and game-over card (with “New High Score!”).
- **Subway-style visuals** — rails/ties, asphalt lanes, scrolling buildings, cartoony runner character, train barriers (jump) and overhead signs (duck), spinning coins.
- **Progressive obstacle patterns** — single, double-lane, jump→duck combos, wall-gap, mixed gates, pose gates; gaps shrink and denser patterns ramp with run distance.
- **Cartoon SFX** — procedural Web Audio whoops/chimes for jump, duck, lane change, coin collect, and death.
- **Hand UI Controls** — menu cursor with pinch-to-click on start, game-over, and calibration buttons. The cursor follows the body tracker's wrist inside a pointing area anchored to your shoulder (sized in shoulder widths), so it works from full-body distance. Pinch runs the hand model on a crop around that wrist.
- **Hand UI Setup** — raise the menu hand (hold bar), then pinch twice (rep dots). Thresholds come from those pinches. A weak pinch/open difference sends you back to pinch with a hint (`HandProfile` v5).
- **Shared webcam stream** — `GameEngine.ensureCameraStarted()` owns the camera; pose and hand trackers share `#webcam`.

### Changed

- **Portrait play** — the game fills a landscape screen rotated 90°. Stand the laptop with the screen on your left and the keyboard on your right. Webcam frames are rotated to match, so pose and hand tracking stay upright.
- **Pose calibration** — seven prompts that advance when the measurement is captured (stand, left, right, jump ×2, duck ×2, run, star jump ×2). Each finished step shows its full bar or both dots briefly before moving on.
- **Pose profile** — version bumped to 7. Jumping uses a fused airborne check: both feet above the floor, or the hips rising after an upward push. Blurred ankles no longer discard the frame. Older profiles are ignored; recalibrate motion controls. Hand UI profiles stay version 5.
- **Cursor** — 1€ filter minimum cutoff 2.5 Hz and a faster speed estimate, so short hand moves stop trailing.
- **Hand model** — runs in the pose worker (or the main-thread fallback) on the same camera frame as pose. The cursor state machine no longer runs its own model.
- **Lane response** — 1€-filtered lane signal and a faster lane-change gain.
- **Camera** — requests 60 fps when the webcam supports it.

### Removed

- **Side-run pose** — gates, keyboard `K`, and calibration step. It looked like a paused running frame from the front camera.
- **Ground star pose** — the avatar no longer copies a star pose held on the ground, and it does not clear gates.
- **Scoring** — distance-based score removed; HUD score is coins × points.
- **Obstacle generation** — pattern waves instead of one random block; larger pool (`POOL_SIZE: 36`).
- **World look** — brighter daytime palette vs dark block prototypes.
- **Start screen** — Hand UI Setup / Enable Hand Controls / Recalibrate Hand UI button; high score line.
- **Hand cursor** — 1€-filtered wrist from the body tracker; pinch uses thumb + index on the wrist crop, with thresholds from setup.
- **Adaptive cursor smoothing** — velocity-based EMA damps jitter without lag on large moves.
- **Shorter runway** — obstacles spawn sooner (`SPAWN_Z: -70`, `FIRST_GAP: 8`).
- **Calibration UI** — pose calibration and hand setup share one screen: step counter, instruction, hold bar or rep dots, Cancel.

### Fixed

- **Recalibrate Hand UI** — clears previous handedness/pinch profile so a different hand can be calibrated fresh.
- **Duck length** — pose duck lasts as long as you crouch instead of a fixed 600 ms.
- **Calibration rep dots** — the second dot fills before the step advances.
- **Missed jumps** — a jump still counts when the ankles blur, as long as the hips rise or another foot point (heel or toe) clears the floor. Both feet confidently on the floor still veto a tiptoe or a sway.
- **Cursor lag** — pinch detection no longer runs on the main thread inside the pose result, so pose frames are not stuck behind the hand model.

## [0.2.0] - 2026-08-06

Compared to the initial commit (`140244e` — WebGPU Motion Runner MVP with edge-triggered lean/hop lane gestures).

### Added

- **Continuous lane control** — pose tracking now classifies the player into left / center / right every frame from calibrated horizontal body position (`laneSignal` → nearest of `{leftX, centerX, rightX}`), instead of firing discrete hop/lean edge events.
- **`poseLane` event bus channel** — `PoseTracker` emits `{ lane: Lane }` each enabled frame; `GameEngine` maps it directly to `physics.setTargetLane()` during gameplay.
- **New calibration lane steps** — after neutral pose capture, users move through explicit `lane_left` → `lane_center` → `lane_right` capture sequences (hold position, average signal) before jump/duck threshold capture.
- **Live 3-lane webcam overlay** — `SkeletonOverlay` draws dashed dividers, lane labels (LEFT / CENTER / RIGHT), and a highlight tint for the active target lane during calibration.
- **Sequential validation flow** — validation runs one target at a time (Left → Center → Right → Jump → Duck) with a stepper UI instead of an all-at-once checklist.
- **Neutral gate for jump/duck validation** — jump and duck verification waits for a sustained neutral pose before arming detection, fixing false auto-checks caused by stale gesture state from the prior capture step.
- **Lane dwell validation** — lane verification requires holding the expected lane for `VALIDATE_LANE_DWELL_MS` using the same continuous classifier used in gameplay.
- **Duck visual squash** — player mesh Y-scale lerps down while ducking (`PhysicsEngine.isDucking()` + `PLAYER.DUCK_VISUAL_SCALE_Y`).
- **`PoseProfile.lanes`** — `{ leftX, centerX, rightX }` replaces per-direction lean thresholds and mirror auto-detection.
- **`laneSignal()` / `classifyLane()` helpers** in `PoseProfile.ts`.
- **Config additions** — `VISION.LANE_SMOOTHING`, `CALIBRATION.MIN_LANE_SEPARATION`, `VALIDATE_NEUTRAL_MS`, `VALIDATE_LANE_DWELL_MS`, `VALIDATE_SUCCESS_PAUSE_MS`, `PLAYER.DUCK_VISUAL_SCALE_Y`, `PLAYER.DUCK_VISUAL_LERP_SPEED`.

### Changed

- **Calibration profile version** bumped from `1` → `2`; saved v1 profiles in `localStorage` are rejected and users must re-calibrate.
- **Calibration step order** — `framing → neutral → lane_left → lane_center → lane_right → jump → duck → validate → done`.
- **Calibration UI** — checklist replaced with a 5-dot stepper and green success flash on each validated step.
- **Duck-under obstacle color** — low obstacles changed from blue (`0x2e86ab`) to green (`0x2ecc71`).
- **`beginValidation` callback** — now two-way `(enabled: boolean) => void` so detection can be toggled off between validation targets and during the neutral gate.

### Removed

- Lean/hop edge-trigger lane logic (`leftArmed`, `rightArmed`, lateral threshold hysteresis, `MOVE_LEFT` / `MOVE_RIGHT` from pose).
- `hop_left` / `hop_right` calibration steps and mirror auto-detection from hop-left peak sign.
- `PoseProfile.mirror`, `thresholds.laneLeft`, `thresholds.laneRight`.
- `VISION.LANE_RATIO`, `VISION.MIRROR` config constants.
- All-at-once validation checklist UI and `.checklist` CSS.

### Fixed

- **Validation false positives** — jump/duck could auto-complete immediately on entering validation because detection was enabled while the user was still in a motion pose from capture; neutral gate + per-step detection reset resolves this.
- **Duck animation not visible** — physics collider shrank on duck but the Three.js capsule mesh never changed; mesh now squashes on Y while ducked.

---

## [0.1.0] - 2026-08-06

Initial release (`140244e`).

### Added

- WebGPU Motion Runner MVP: Vite + TypeScript, Three.js WebGPU/WebGL fallback, Rapier3D physics, MediaPipe pose tracking.
- Keyboard and webcam pose input (edge-triggered jump, duck, hop-left, hop-right lane changes).
- Guided calibration (framing, neutral baseline, jump/duck/hop capture, all-at-once validation checklist).
- Personal pose profile saved to `localStorage`.
- Endless runner with obstacle spawning, score, game over, and start menu.
