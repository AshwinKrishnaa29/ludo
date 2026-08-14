import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// The dev server proxies every API path to the services, so the browser only
// ever talks to one origin. That keeps development identical to production,
// where an ingress does the same routing - no CORS, no cross-site cookies.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@ludo/shared': path.resolve(here, '../packages/shared/src/index.ts'),
      '@': path.resolve(here, 'src'),
    },
  },
  server: {
    port: 4000,
    proxy: {
      '/sessions': 'http://localhost:4004',
      '/rooms': 'http://localhost:4004',
      '/games': 'http://localhost:4004',
      '/graphql': 'http://localhost:4005',
      '/socket.io': { target: 'http://localhost:4004', ws: true },
    },
  },
  build: {
    // The gateway serves the built client, so a production build lands
    // straight into its static directory.
    outDir: path.resolve(here, '../services/gateway/public'),
    emptyOutDir: true,
  },
});