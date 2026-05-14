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
  },
});
