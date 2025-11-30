import baseConfig from '@kitiumai/config/eslint.config.base.js';
import { createKitiumConfig } from '@kitiumai/lint';

export default createKitiumConfig({
  baseConfig,
  ignorePatterns: ['dist/**', '**/*.d.ts', '**/*.d.cts'],
  additionalRules: {
    // Error package specific rules
    complexity: ['warn', 20], // Error handling can be complex
    '@typescript-eslint/naming-convention': [
      'error',
      {
        selector: 'default',
        format: ['camelCase'],
        leadingUnderscore: 'allow',
        trailingUnderscore: 'allow',
      },
      {
        selector: 'variable',
        format: ['camelCase', 'UPPER_CASE'],
        leadingUnderscore: 'allow',
        trailingUnderscore: 'allow',
      },
      {
        selector: 'typeLike',
        format: ['PascalCase'],
      },
      {
        selector: 'enumMember',
        format: ['PascalCase', 'UPPER_CASE'],
      },
      {
        // Allow snake_case for error kind properties (they're enum-like values)
        selector: 'objectLiteralProperty',
        format: ['camelCase', 'snake_case'],
      },
    ],
  },
  overrides: [
    {
      files: ['src/index.ts'],
      rules: {
        // Allow snake_case enum-like keys in metrics maps
        '@typescript-eslint/naming-convention': 'off',
      },
    },
    {
      files: ['**/*.test.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off', // Allow any in tests
        '@typescript-eslint/explicit-function-return-type': 'off',
      },
    },
  ],
});
