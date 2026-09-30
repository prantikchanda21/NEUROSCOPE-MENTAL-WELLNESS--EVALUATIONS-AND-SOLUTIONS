import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {neuroscopeServiceWorker} from './vite-plugin-sw';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), neuroscopeServiceWorker()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    optimizeDeps: {
      // Don't let esbuild pre-bundle these — @huggingface/transformers
      // conditionally imports onnxruntime-web/webgpu, which esbuild's
      // dependency scanner fails to resolve ("Failed to resolve import
      // onnxruntime-web/webgpu"). Leaving them out of pre-bundling lets
      // the browser load them natively at runtime instead.
      exclude: ['@huggingface/transformers', 'onnxruntime-web'],
    },
    // The semantic engine runs its models inside Web Workers (src/workers).
    // A worker that dynamically imports @huggingface/transformers is
    // code-split, and Vite's default worker format (iife) cannot do that —
    // 'es' produces a proper module worker for both dev and production.
    worker: {
      format: 'es' as const,
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
