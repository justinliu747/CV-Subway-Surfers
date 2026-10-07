# WebGPU Motion Runner MVP

A basic endless runner controlled by webcam pose (MediaPipe) and keyboard, rendered with Three.js `WebGPURenderer` and simulated with Rapier3D WASM physics.

## Stack

- **Vite + TypeScript** — build tooling
- **Three.js (`three/webgpu`)** — WebGPU renderer with automatic WebGL 2 fallback
- **@dimforge/rapier3d-compat** — physics (WASM embedded, no Vite WASM plugins)
- **@mediapipe/tasks-vision** — PoseLandmarker for jump / duck / lane gestures

## Setup

```bash
npm install
npm run dev
```

Open the printed local URL (usually `http://localhost:5173`).

Stand the laptop so the screen is on your left and the keyboard is on your right. Windows stays in landscape. The game rotates itself to fill that screen in portrait, and the webcam image is rotated the same way so pose tracking still sees you upright.

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck + production bundle → `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` only |

## Start screen

On boot you get a start menu (no camera prompt yet):

| Button | What it does |
|---|---|
| **Play with Keyboard** | Starts immediately — never asks for the camera |
| **Motion Controls** | Uses a saved calibration if present; otherwise opens guided calibration |
| **Calibrate / Recalibrate** | Runs the guided pose setup and saves a personal profile |

Camera permission is deferred until you choose Motion Controls or Calibrate.

## Controls

### Keyboard

| Action | Keys |
|---|---|
| Move left | `←` / `A` |
| Move right | `→` / `D` |
| Jump | `↑` / `W` / `Space` |
| Duck | `↓` / `S` |
| Star jump (star gates) | `J` |
| Restart after game over | Restart button or Jump |
| Main Menu | Game Over → Main Menu |

### Pose (webcam)

Motion controls read your **body state**, not one-off gestures. Lengths are measured against your standing leg length, so distance from the camera does not matter.

- **Jump** — both feet leave the floor, or your hips rise after a clear upward push. A blurred or missing ankle no longer throws the jump away. Both feet confidently on the floor (a tiptoe, a sway) does not count. Running in place keeps a foot down, so it never jumps. The game also fires on the push after a wind-up dip, a frame or two before your feet leave.
- **Duck** — head down with feet planted, held. The avatar stays down exactly as long as you do and squashes with your crouch depth. A jump wind-up or a landing dip does not count as a duck.
- **Lane** — stand in the left, center, or right position captured during calibration.
- **Run in place** — keeps the stamina bar full; standing still drains it. Jumps, ducks, and star jumps count as activity.
- **Star gates** — star jump: arms up and out with feet wide *while in the air*. A star pose on the ground does not clear the gate.

Obstacles are judged with a short timing window, so a jump or duck that lands a little late (body and camera delay) still clears.

## Calibration

Seven short prompts. Each one advances as soon as the movement is measured — there is no countdown and no separate validation pass. Jump, duck, and star-jump reps are counted by the same detectors the game uses. A live skeleton shows framing. Cancel is the only button.

1. **Stand still in the middle** — floor line, leg length, head and hip height, center lane, idle motion
2. **Step to your left** — hold it
3. **Step to your right** — must be the opposite side of center from step 2
4. **Jump twice** — both feet off the floor, or a hip rise when the feet blur
5. **Duck down and hold, twice** — held long enough that a wind-up dip does not count
6. **Run in place**
7. **Star jump twice** — arms up and out, feet wide, in the air

If a step isn't met, the instruction changes to a short hint (step farther, jump higher, and so on). Saved profiles are version 7; older ones are ignored and motion controls ask you to calibrate again.

## Hand controls (menus)

Menus can be driven by hand from where you stand to play.

- **Cursor** — follows your wrist from the body tracker, inside a pointing area anchored to your shoulder and sized by your shoulder width. Distance from the camera and where you stand do not matter. Lower your arm to hide it.
- **Click** — pinch your thumb and index finger and hold for a moment. The hand model runs on a crop of the same camera frame as pose, in the pose worker, so the cursor does not wait on a second model on the main thread.
- **Hand UI Setup** — raise the hand you'll use (hold bar), then pinch twice (rep dots). There are no corners to set.

## Debug overlay

Open `?debug`, press the backtick key, or use **Debug** on the start screen:

- whether inference runs in the worker or on the main thread, plus model and delegate
- camera fps, pose fps, pose inference time, hand inference time, and capture-to-result delay
- delay from the camera frame to the jump event
- live traces of foot lift, hip lift, crouch depth, and star score, against their thresholds

**Record / Save**, **Replay**, **Clear**, and **Close** are buttons (mouse or pinch). **R**, **L**, and **C** still work. Replay reports how many jumps came from the feet, the hips, or both.

URL switches for comparison: `?model=full` uses the full pose model, and `?mainthread` skips the inference worker.

### Clear a saved profile

In the browser console:

```js
localStorage.removeItem('subway-surfers-pose-profile-v1')
```

Then reload and choose **Calibrate** again.

## WebGPU / WebGL fallback

The app probes `navigator.gpu` at boot and logs the active backend.

- Default: WebGPU when available, otherwise WebGL 2 via Three.js
- Force WebGL for testing: open `http://localhost:5173/?forceWebGL`

## LAN / mobile testing

`getUserMedia` works on `localhost` without HTTPS. Testing from a phone on your LAN typically requires HTTPS (browser camera policy). Options:

- Tunnel with something like [ngrok](https://ngrok.com/) or Vite's HTTPS plugin
- Or test pose on desktop localhost and keyboard on LAN HTTP

`vite.config.ts` sets `server.host: true` so the LAN URL is advertised.

## Self-hosting MediaPipe assets

By default, WASM and the lite pose model load from CDNs defined in `src/config/GameConfig.ts`:

```ts
WASM_BASE: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
MODEL_URL: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
```

To self-host:

1. Copy `node_modules/@mediapipe/tasks-vision/wasm` → `public/mediapipe/wasm`
2. Download the `.task` model into `public/mediapipe/`
3. Point `VISION.WASM_BASE` / `VISION.MODEL_URL` at those local paths

## Project layout

```
src/
├── main.ts
├── config/GameConfig.ts
├── core/                   # types + EventBus
├── vision/
│   ├── PoseTracker.ts      # frames → inference → BodyState → pose events
│   ├── PoseInference.ts    # worker or main-thread MediaPipe
│   ├── poseWorker.ts
│   ├── BodyState.ts        # airborne, crouch, takeoff, run, lane, star jump
│   ├── PoseFeatures.ts     # per-frame sample + star angles (world landmarks)
│   ├── OneEuroFilter.ts
│   ├── PoseCalibrator.ts
│   ├── PoseProfile.ts
│   └── SkeletonOverlay.ts
├── input/KeyboardSource.ts
├── physics/PhysicsEngine.ts
├── graphics/GameRenderer.ts
├── engine/                 # GameEngine + ObstacleManager
└── ui/                     # HUD, StartScreen, CalibrationScreen, DebugOverlay, ui.css
```

## Architecture notes

- Pose loop uses `requestVideoFrameCallback` (falls back to `requestAnimationFrame`), with one frame in flight at a time
- Pose inference runs in a module worker when available, so it does not block rendering
- Vertical body signals and the lane signal use 1€ filters; standing baselines follow slow drift
- Physics uses a fixed 60 Hz accumulator
- Rendering uses `renderer.setAnimationLoop`
- The world scrolls toward a near-stationary player (`z ≈ 0`)
- Obstacles are kinematic sensor colliders; in motion mode a hit is held open briefly and forgiven if the needed action lands in its window
- Skeleton overlay uses a separate 2D canvas (never shares the WebGPU canvas)
