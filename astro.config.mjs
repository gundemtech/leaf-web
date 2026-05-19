// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://leaf.gundem.tech',
  trailingSlash: 'never',
  build: {
    format: 'directory',
  },
  vite: {
    css: {
      transformer: 'postcss',
    },
    // Dev-only proxy: in production `/api/*` is handled by the leaf-contact
    // Cloudflare Worker via the nginx route. In `astro dev` (port 4321), fetch
    // those paths through a local wrangler dev (port 8787) so the live counter
    // and waitlist form work end-to-end without deploying.
    server: {
      proxy: {
        '/api': 'http://localhost:8787',
      },
    },
  },
});
