import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'esnext',
  },
  // The pose worker is a module worker (MediaPipe's ES-module Wasm loader).
  worker: {
    format: 'es',
  },
  server: {
    host: true,
  },
  preview: {
    host: true,
  },
});
