import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', 'docs/design/**', 'secrets/**', 'backups/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/parent/src/**'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['apps/parent/public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
);
