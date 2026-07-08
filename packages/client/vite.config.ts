import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build also works when deployed under a
  // sub-path (e.g. https://host/mein-spiel/) instead of only at the domain root.
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
});
