import { defineConfig } from 'vitest/config';

// Unit tests for pure, DOM-free logic only (src/scripts/*-logic.ts). The
// dashboard's DOM wiring + atomic reveal are verified by hand against a running
// dev server — see the dashboard work for why we deliberately skip browser e2e.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
