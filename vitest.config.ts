import { createKitiumVitestConfig } from '@kitiumai/vitest-helpers/config';
import { defineConfig } from 'vitest/config';

export default defineConfig(
  createKitiumVitestConfig({
    preset: 'library',
    environment: 'node',
  })
);
