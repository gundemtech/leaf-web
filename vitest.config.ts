import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // isomorphic-dompurify provides its own (jsdom-backed) DOM in Node,
    // so the default node environment is sufficient — no jsdom env needed.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
