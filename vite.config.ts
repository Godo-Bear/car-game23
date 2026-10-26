import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset URLs so the build works on any Cloudflare Pages URL
  // (production domain, *.pages.dev preview branches, or a sub-path).
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    // three.js alone is ~700 kB minified; that's expected for a 3D game.
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
