import { defineConfig } from 'vite';

// Relative base so the build works from any path, including GitHub Pages.
export default defineConfig({ base: './', build: { target: 'es2020', chunkSizeWarningLimit: 800 } });
