/**
 * ESLint configuration for @kitiumai/error.
 * Composes the strict @kitiumai/lint presets (base + TS + Node + Security + Kitium).
 */

import {
  eslintBaseConfig,
  eslintKitiumConfig,
  eslintNodeConfig,
  eslintSecurityConfig,
  eslintTypeScriptConfig,
} from '@kitiumai/lint';

const normalize = (config) => (Array.isArray(config) ? config : [config]);

const sharedPresets = [
  ...normalize(eslintBaseConfig),
  ...normalize(eslintTypeScriptConfig),
  ...normalize(eslintNodeConfig),
  ...normalize(eslintSecurityConfig),
  ...normalize(eslintKitiumConfig),
];

export default [
  {
    ignores: ['dist/', 'node_modules/', 'coverage/', '.turbo/', '**/*.d.ts'],
  },
  ...sharedPresets,
  {
    name: 'kitium/error-overrides',
    files: ['**/*.{ts,tsx,js,cjs,mjs}'],
    rules: {
      // Re-apply the shared import restriction with ESLint v9-compatible schema.
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              group: ['../../*', '../../../*'],
              message: 'Prefer module aliases over deep relative imports for maintainability.',
            },
          ],
        },
      ],
      // Disabled temporarily due to eslint-plugin-import relying on CJS-only minimatch.
      'import/order': 'off',
    },
  },
];
