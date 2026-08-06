# Web Dev Fundamentals — Personal Learning Notes

Notes from planning the Subway Surfers MVP project. Covers npm dependencies, Vite, bundling, and how the pieces fit together.

---

## Table of Contents

1. [npm: dependencies vs devDependencies](#1-npm-dependencies-vs-devdependencies)
2. [Plain install vs pinned versions (`-D` explained)](#2-plain-install-vs-pinned-versions--d-explained)
3. [Library vs package vs dependency](#3-library-vs-package-vs-dependency)
4. [What is Vite?](#4-what-is-vite)
5. [Dev mode vs production mode](#5-dev-mode-vs-production-mode)
6. [Is Vite just a translator/compiler?](#6-is-vite-just-a-translatorcompiler)
7. [What is bundling and why do we need it?](#7-what-is-bundling-and-why-do-we-need-it)
8. [Why one import can pull in many files](#8-why-one-import-can-pull-in-many-files)
9. [Runtime deps vs dev deps (Subway Surfers example)](#9-runtime-deps-vs-dev-deps-subway-surfers-example)
10. [Quick reference cheat sheet](#10-quick-reference-cheat-sheet)

---

## 1. npm: dependencies vs devDependencies

### The rule (one sentence)

- **`dependencies`** = needed when the game **runs** in the browser
- **`devDependencies` (`-D`)** = needed only while you **build or develop**; never shipped to players

It is not really "exposed to the user vs hidden." It is **runtime vs build-time**.

### `dependencies` (runtime)

Libraries your **running code imports and calls**. Vite bundles them into the final output. Players need them.

Examples for this project:
- `three` — 3D rendering
- `@dimforge/rapier3d-compat` — physics
- `@mediapipe/tasks-vision` — pose detection

### `devDependencies` (build/dev only)

Tools and type definitions used on **your machine** during development and build. They are **not** part of what runs in the browser after a production build.

Examples for this project:
- `vite` — dev server + bundler
- `typescript` — compiles `.ts` → `.js`
- `@types/three` — TypeScript type hints for Three.js
- `@webgpu/types` — TypeScript type hints for `navigator.gpu`

### Analogy

Building a board game:

- **Dependencies** = cards, dice, board (players need these to play)
- **Dev dependencies** = printer, design software, ruler (you need these to manufacture the game; players never see them)

---

## 2. Plain install vs pinned versions; `-D` explained

### Plain install is fine

You do **not** need version numbers unless you want to lock to a specific release:

```bash
# Runtime dependencies (bundled into the game)
npm install three @dimforge/rapier3d-compat @mediapipe/tasks-vision

# Dev-only dependencies (build tooling, not shipped to players)
npm install -D vite typescript @types/three @webgpu/types
```

npm installs the latest compatible versions from the registry. That is the normal approach for a new project.

### Why plans sometimes show `@0.185.1` etc.

Version pins like `three@0.185.1` are **optional**. They exist for:

- **Reproducible builds** — everyone gets the exact same version
- **Documentation** — confirming compatibility at planning time
- **Stability** — avoiding a future breaking update

They are not required to get started.

### What is `-D`?

`-D` is shorthand for `--save-dev`. It tells npm to save packages under `devDependencies` in `package.json` instead of `dependencies`.

| | `dependencies` | `devDependencies` (`-D`) |
|---|---|---|
| **What** | Libraries the game needs at runtime | Tools used only while building/developing |
| **Examples** | `three`, `rapier`, `mediapipe` | `vite`, `typescript`, type packages |
| **Shipped to players?** | Yes (bundled by Vite) | No |

When you run `npm run build`, Vite bundles runtime deps into the output. It does **not** bundle Vite or TypeScript — those only exist on your machine during development.

---

## 3. Library vs package vs dependency

These terms are related but not identical.

### Library (lib)

Reusable code someone wrote for you to use.

- Three.js is a **graphics library**
- Rapier is a **physics library**

This is a **concept** — a collection of useful code.

### Package

How that code is **distributed and installed** — usually via npm.

- The npm package name is `three`
- `npm install three` downloads the package into `node_modules/three/`

A library is often published **as** a package. People use the words interchangeably in casual conversation, but they refer to different layers.

### Dependency

Something **your project depends on** — the relationship from your project's point of view.

In `package.json`:

```json
"dependencies": {
  "three": "^0.185.0",
  "@dimforge/rapier3d-compat": "^0.19.3"
}
```

Those entries are your **dependencies**. Each one is also an npm **package**. Each package provides a **library**.

### Analogy

| Term | Analogy |
|---|---|
| **Library** | The engine in a car |
| **Package** | The boxed engine shipped from the factory (with manual, bolts, etc.) |
| **Dependency** | "My car needs this engine to run" |

For this project you might say:

- "Three.js is a **library** we use for 3D rendering"
- "We install the `three` **package** with npm"
- "`three` is a **dependency** of our project"

All three sentences are correct — they describe the same thing from different angles.

---

## 4. What is Vite?

**Vite** (pronounced "veet", French for "fast") is a **development tool** that helps you build and run modern web apps — especially ones written in TypeScript and using libraries like Three.js.

Think of it as the **middle layer** between your source code and what actually runs in the browser.

### The problem it solves

Browsers do not natively understand everything you write. Your project uses:

- **TypeScript** (`.ts` files) — browsers only understand JavaScript
- **npm packages** like `three`, `rapier`, `mediapipe` — hundreds of files in `node_modules`
- **ES module imports** like `import { GameEngine } from './engine/GameEngine'` — need to be wired together

You *could* manually convert TypeScript, bundle files, and refresh the browser yourself. Vite automates all of that.

### What Vite helps with

| Without Vite | With Vite |
|---|---|
| Run `tsc` to compile TS, then refresh browser | One command, auto-compile + auto-refresh |
| Manually script how to bundle Three.js + Rapier + your code | Vite handles bundling via Rollup under the hood |
| Configure WASM/asset loading yourself | Vite knows how to import most modern formats |
| Slow full rebuilds on every save | HMR updates only what changed |

### How it fits the project stack

```
Your .ts source files
        ↓
      Vite (dev server OR build)
        ↓
   Browser-ready JavaScript + assets
        ↓
   Chrome runs Three.js + Rapier + MediaPipe
```

- **TypeScript** = the language you write in
- **Vite** = the tool that prepares and serves/bundles your code
- **Three.js / Rapier / MediaPipe** = the game libraries Vite bundles for you

You won't interact with Vite much day-to-day beyond `npm run dev` and `npm run build`. Most of your time goes into the game code under `src/`.

### Analogy

Vite is like a **kitchen in a restaurant**:

- **Dev mode** = open kitchen where you taste and adjust recipes instantly as you cook
- **Production build** = packaging meals for delivery — portioned, sealed, optimized for the customer

You cook in the open kitchen; customers get the packaged version.

---

## 5. Dev mode vs production mode

### Dev mode (`npm run dev`)

Vite starts a **local development server** on your machine (usually `http://localhost:5173`).

What it does:

1. **Serves your app** — open that URL in Chrome and see your game
2. **Transforms on the fly** — TypeScript → JavaScript, imports resolved, etc.
3. **Hot Module Replacement (HMR)** — change a file, save, and the browser updates without a full page reload (often in under a second)
4. **Fast startup** — Vite only processes the files you are actually using, not your entire project at once

Dev mode is for **you while building**. It is not what you ship to players.

Characteristics:

- Source maps so errors point to your `.ts` files
- Unminified code (easier to debug)
- Extra checks and helpful error messages
- A local server only you can access (unless configured otherwise)

### Production mode (`npm run build`)

When you are ready to share the game, you run **build**. Vite:

1. **Bundles** all your code + dependencies into a small set of optimized files
2. **Minifies** — removes whitespace, shortens variable names (smaller downloads)
3. **Tree-shakes** — drops unused code from libraries
4. **Outputs** a `dist/` folder you can host anywhere (Netlify, GitHub Pages, your own server)

Production mode is what **players actually load**. It is optimized for speed and size, not for your convenience while coding.

| | Dev mode | Production mode |
|---|---|---|
| **Command** | `npm run dev` | `npm run build` |
| **Output** | Runs in memory, served live | Static files in `dist/` |
| **Speed goal** | Fast rebuilds while you edit | Fast load for end users |
| **Code size** | Larger, readable | Smaller, minified |
| **Who uses it** | You, the developer | Players / public |

---

## 6. Is Vite just a translator/compiler?

**Mostly yes — with two important additions.**

Vite is mainly a **translator + bundler + dev server**, not just a compiler.

### What it translates

| You write | Browser understands |
|---|---|
| TypeScript (`.ts`) | Plain JavaScript |
| `import X from 'three'` | One or a few script files the browser can load |
| Modern JS syntax | Older/safer JS if needed (via build targets) |

So yes: it turns **modern dev code** into **basic JS the browser can run**.

### What else it does (beyond translation)

1. **Dev server** — hosts your app locally while you work
2. **Bundler** — combines your files + libraries into loadable chunks
3. **Hot reload** — pushes updates to the browser when you save

### Tighter mental model

> **Vite = translator + packager + local preview server**

- **Translator** — TypeScript → JS, resolve imports
- **Packager** — stitch your modules and npm packages together
- **Preview server** — run and iterate quickly in dev; output optimized static files for production

---

## 7. What is bundling and why do we need it?

### What bundling means

**Bundling** means taking many separate source files and npm packages and **combining them into fewer files** that browsers can load efficiently.

When you write:

```ts
import * as THREE from 'three/webgpu';
import { GameEngine } from './engine/GameEngine';
import { PoseTracker } from './vision/PoseTracker';
```

You might have:

- 10 of your own `.ts` files
- `three` alone = hundreds of internal files in `node_modules`
- `rapier`, `mediapipe`, etc.

Browsers **can** load many files with `import`, but in production that is slow:

- Each file = a separate HTTP request
- More requests = slower load, especially on mobile
- Some packages are not written as "open this one file in the browser" — they expect a bundler

So bundling **merges** (and optimizes) that graph into something like:

```
dist/
  index.html
  assets/
    index-a3f9c2.js    ← your game + three + rapier + your modules
    index-b7e1d4.css   ← styles (if any)
```

Instead of the browser fetching 500+ files, it might fetch **1–3**.

### Does it change the file structure?

**Yes — but only for the production output**, not your source code.

| | Your project (source) | After `npm run build` (bundled) |
|---|---|---|
| **Structure** | `src/vision/PoseTracker.ts`, `src/engine/GameEngine.ts`, etc. | Flattened into `dist/assets/*.js` |
| **Who reads it** | You, in your editor | Browsers / players |
| **Readable?** | Yes, organized by feature | Minified, hard to read (on purpose) |

Your `src/` folder stays exactly as you wrote it. Vite creates a **new** `dist/` folder optimized for delivery.

Analogy:

- **Source** = manuscript with chapters in separate Word docs
- **Bundle** = one printed book sent to readers

Same content, different packaging.

### Other production optimizations (beyond merging files)

During bundling, Vite (via Rollup) also:

1. **Tree-shaking** — if you import one function from a library but never use the rest, drop the unused parts
2. **Minification** — `function calculatePlayerScore()` → `function a()`; remove spaces and comments
3. **Code splitting** (optional) — split into a few chunks instead of one giant file if that loads faster
4. **Asset hashing** — `index-a3f9c2.js` so browsers cache aggressively and know when something changed

Bundling is not just "glue files together" — it is **glue + shrink + clean**.

### Why dev does not bundle the same way

In **dev** (`npm run dev`), Vite does **not** fully bundle upfront. It serves files on demand and translates TypeScript as you request them. That is why dev starts fast and hot reload works.

In **production** (`npm run build`), players need:

- **Fast first load** — fewer, smaller files
- **Works everywhere** — one coherent package
- **Smaller download** — minified, dead code removed

That is what full bundling is for.

### Concrete example for this game

**Before bundle (conceptually):**

```
src/main.ts
src/engine/GameEngine.ts
src/vision/PoseTracker.ts
src/physics/PhysicsEngine.ts
node_modules/three/build/three.webgpu.js
node_modules/@dimforge/rapier3d-compat/...
... hundreds more ...
```

**After bundle:**

```
dist/index.html          ← loads the script
dist/assets/index-xyz.js ← everything the game needs to run
```

The browser loads `index.html`, which loads **one main JS file** (maybe plus a WASM chunk for Rapier/MediaPipe). Your game starts.

### One-line summary

> **Bundling = take your many source files and libraries, merge them into a few browser-ready files, and strip out anything unnecessary so the game loads fast for players.**

Your source structure stays clean and modular for development; the bundle is a **delivery format**, not how you organize code day to day.

---

## 8. Why one import can pull in many files

### The confusion

Your import line looks small:

```ts
import * as THREE from 'three/webgpu';
```

So it feels like you are only asking for one thing. Why would that be a problem?

### An import is a starting point, not the whole story

When you write `import { GameEngine } from './engine/GameEngine'`, the tool does not stop at one file. It opens `GameEngine.ts`, sees more imports inside it, opens those, and keeps going:

```
main.ts
  → GameEngine.ts
    → PhysicsEngine.ts
      → @dimforge/rapier3d-compat
        → (lots of internal rapier files)
  → GameRenderer.ts
    → three/webgpu
      → (lots of internal three.js files)
```

You wrote **one** import, but the runtime may need **dozens or hundreds** of files to satisfy it.

### "Part of a lib" vs "all files"

Two different ideas often get mixed up:

| What you mean | What actually happens |
|---|---|
| "I only use `WebGPURenderer` from Three.js" | True at the **API** level — you do not call every Three.js function |
| "Only one file gets loaded" | Not true without bundling + tree-shaking — the module graph still pulls in what your code path needs |

**Tree-shaking** (during production build) removes code you never reference. But it still has to **analyze the whole graph first**, and whatever remains gets bundled together.

Imports are not "bad." **Many separate network requests in production** is what hurts load time.

### Why dev feels fine but production cares

In **dev**, Vite serves files on demand over localhost. Hundreds of small requests are okay on your machine.

In **production**, a player on mobile might download your game over LTE. Then:

- 200 requests × latency = slow start
- Many small files = harder to cache efficiently

Bundling turns "maybe 200 files" into "1–3 files" for the player.

### Analogy

Your imports are the **front door**. Bundling is what happens when you walk through and discover how big the building actually is — then pack only what you need into a suitcase for the trip (production).

---

## 9. Runtime deps vs dev deps (Subway Surfers example)

### Runtime deps — executed in the browser

```ts
import * as THREE from 'three/webgpu';        // renders the 3D scene
import RAPIER from '@dimforge/rapier3d-compat'; // runs physics every frame
import { PoseLandmarker } from '@mediapipe/tasks-vision'; // reads webcam
```

When Vite builds, it **bundles** Three.js and Rapier **into** `dist/assets/index-xyz.js`. MediaPipe code gets bundled too (models/WASM may still load from URLs at runtime).

The browser executes that code. Players need it. → **`dependencies`**

### Dev deps — your machine only

| Package | Role | In final `dist/`? |
|---|---|---|
| **vite** | Dev server + bundler | No |
| **typescript** | `.ts` → `.js` at build time | No (only the JS output remains) |
| **@types/three** | Type hints for Three.js in your editor | No |
| **@webgpu/types** | Type hints for `navigator.gpu` | No |

TypeScript and `@types/*` are **erased entirely** — they never become JS. They exist only so TypeScript can check your code and give you autocomplete.

Vite runs on **your machine** during `npm run dev` / `npm run build`. Players never install or download Vite.

→ **`devDependencies`**

### `three` is NOT in both — two different packages

| Package | What it is | dep type |
|---|---|---|
| **`three`** | The actual Three.js library (JS that runs in the browser) | `dependencies` |
| **`@types/three`** | TypeScript definitions *for* Three.js (`.d.ts` files only) | `devDependencies` |

- `three` = the engine
- `@types/three` = the instruction manual for TypeScript about the engine

You install both, but only `three` ends up in the bundled game.

### Corrected mental model

| Easy-to-misread framing | Better framing |
|---|---|
| "Runtime deps are exposed to the user" | "Runtime deps are **executed in the browser** when someone plays" |
| "Dev deps get translated to JS" | "Dev deps **don't ship at all** — they're tools/types used before/during the build" |

TypeScript does not "become" the game. TypeScript **compiles your source** into JS. The `typescript` package itself is the compiler tool — like a factory machine, not a part of the product.

### Full build flow

```
You write:     main.ts, GameEngine.ts  (+ types from @types/three)
Build tools:   vite + typescript         (dev only, on your machine)
Output:        dist/assets/index.js      (plain JS + bundled three + rapier)
Player runs:   index.js in Chrome         (no vite, no typescript, no @types)
```

---

## 10. Quick reference cheat sheet

### Commands

```bash
npm install three @dimforge/rapier3d-compat @mediapipe/tasks-vision   # runtime
npm install -D vite typescript @types/three @webgpu/types             # dev only
npm run dev      # local dev server, hot reload
npm run build    # production bundle → dist/
```

### Terminology

| Term | Meaning |
|---|---|
| **Library** | Reusable code (concept) |
| **Package** | npm install unit (artifact in `node_modules/`) |
| **Dependency** | Something your project depends on (listed in `package.json`) |
| **Bundling** | Merging many source/module files into few optimized output files |
| **Tree-shaking** | Removing unused code from the bundle |
| **HMR** | Hot Module Replacement — live updates in dev without full reload |

### This project's split

| `dependencies` (ships) | `devDependencies` (dev machine only) |
|---|---|
| `three` | `vite` |
| `@dimforge/rapier3d-compat` | `typescript` |
| `@mediapipe/tasks-vision` | `@types/three` |
| | `@webgpu/types` |

---

*Last updated: August 2026 — notes from Subway Surfers MVP planning session.*
