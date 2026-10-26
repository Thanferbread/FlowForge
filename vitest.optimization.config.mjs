import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node',
  include: ['scripts/optimization-experiment.test.mjs'], reporters: ['default'] } });
