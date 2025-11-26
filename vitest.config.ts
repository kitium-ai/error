import { createKitiumVitestConfig, loadKitiumVitestBaseConfig } from '@kitiumai/vitest-helpers';

const baseConfig = loadKitiumVitestBaseConfig();

export default createKitiumVitestConfig({
  environment: 'node',
  overrides: {
    ...baseConfig,
  },
});
