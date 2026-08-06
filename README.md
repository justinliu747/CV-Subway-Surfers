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
| Restart after game over | Restart button or Jump |
| Main Menu | Game Over → Main Menu |

### Pose (webcam)

Gestures are driven by your **calibrated personal thresholds**, not fixed guesses:

- **Jump** — shoulders rise relative to your baseline
- **Duck** — shoulders drop / crouch
- **Lane change** — hop / lean left or right (body centre + nose blend)

## Guided calibration

1. **Framing** — get nose, shoulders, and hips in view (live MediaPipe skeleton overlay)
2. **Neutral** — stand still while a baseline and noise floor are measured
3. **Jump / Duck / Hop Left / Hop Right** — countdown, then perform each move 2–3 times
4. **Validate** — try each gesture once; checklist lights up as they fire (skippable)
5. **Save** — profile is written to `localStorage`

Extras:

- Weak / near-still captures are rejected with **Retry**
- **Mirror auto-detection** from the Hop Left step (fixes inverted lean)
- Separate left/right lane thresholds
- Hips are required for framing, then optional so deep crouches still duck

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
│   ├── PoseTracker.ts
│   ├── PoseCalibrator.ts
│   ├── PoseProfile.ts
│   └── SkeletonOverlay.ts
├── input/KeyboardSource.ts
├── physics/PhysicsEngine.ts
├── graphics/GameRenderer.ts
├── engine/                 # GameEngine + ObstacleManager
└── ui/                     # HUD, StartScreen, CalibrationScreen, ui.css
```

## Architecture notes

- Pose loop uses `requestVideoFrameCallback` (falls back to `requestAnimationFrame`)
- Physics uses a fixed 60 Hz accumulator
- Rendering uses `renderer.setAnimationLoop`
- The world scrolls toward a near-stationary player (`z ≈ 0`)
- Obstacles are kinematic sensor colliders; hits end the run
- Skeleton overlay uses a separate 2D canvas (never shares the WebGPU canvas)
