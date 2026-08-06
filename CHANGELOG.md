# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Hand UI Controls** — MediaPipe Hands cursor for menu screens with pinch-to-click on start, game-over, and calibration buttons.
- **Hand UI Setup** — separate calibration: pinch/open cycles, 4-corner interaction area, handedness lock (`HandProfile` v3 in localStorage).
- **Shared webcam stream** — `GameEngine.ensureCameraStarted()` owns the camera; pose and hand trackers share `#webcam`.

### Changed

- **Start screen** — Hand UI Setup / Enable Hand Controls / Recalibrate Hand UI button.
- **Hand cursor** — tracks wrist; pinch uses thumb + index; scale-normalized `pinchRatio` thresholds from calibration.
- **Adaptive cursor smoothing** — velocity-based EMA damps jitter without lag on large moves.
- **Shorter runway** — obstacles spawn sooner (`SPAWN_Z: -70`, `FIRST_GAP: 8`).
- **Calibration UI** — larger stage instructions; 1.5s pinch/open dwell during hand setup.

### Fixed

- **Recalibrate Hand UI** — clears previous handedness/pinch profile so a different hand can be calibrated fresh.

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
