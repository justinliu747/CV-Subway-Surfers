import './ui/ui.css';
import { GameEngine } from './engine/GameEngine';

function parseForceWebGL(): boolean {
  return new URLSearchParams(window.location.search).has('forceWebGL');
}

async function probeCapabilities(): Promise<{ forceWebGL: boolean }> {
  const forceWebGL = parseForceWebGL();
  console.info('[boot] forceWebGL =', forceWebGL);

  const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
  console.info('[boot] navigator.gpu present =', hasWebGPU);

  if (hasWebGPU && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      console.info('[boot] WebGPU adapter =', adapter ? 'available' : 'null');
    } catch (error) {
      console.warn('[boot] WebGPU adapter request failed:', error);
    }
  } else {
    console.warn('[boot] WebGPU unavailable — WebGL 2 fallback path will be used');
  }

  const hasMedia = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  console.info('[boot] getUserMedia available =', hasMedia);

  const hasWasm = typeof WebAssembly !== 'undefined';
  console.info('[boot] WebAssembly available =', hasWasm);

  return { forceWebGL };
}

function showBootError(message: string): void {
  const el = document.getElementById('boot-error');
  if (!el) return;
  el.textContent = message;
  el.classList.add('visible');
}

async function main(): Promise<void> {
  try {
    const { forceWebGL } = await probeCapabilities();

    const container = document.getElementById('game-container');
    const hudRoot = document.getElementById('hud');
    const uiRoot = document.getElementById('ui-root');
    const video = document.getElementById('webcam');
    const cameraStage = document.getElementById('camera-stage');
    const skeletonCanvas = document.getElementById('skeleton');

    if (
      !container ||
      !hudRoot ||
      !uiRoot ||
      !(video instanceof HTMLVideoElement) ||
      !cameraStage ||
      !(skeletonCanvas instanceof HTMLCanvasElement)
    ) {
      throw new Error('Missing required DOM elements');
    }

    const engine = new GameEngine({
      container,
      hudRoot,
      uiRoot,
      video,
      cameraStage,
      skeletonCanvas,
      forceWebGL,
    });

    await engine.init();
    engine.start();
    console.info('[boot] Start menu ready (camera deferred until motion/calibrate)');
  } catch (error) {
    console.error('[boot] Fatal error:', error);
    showBootError(error instanceof Error ? error.message : String(error));
  }
}

void main();
