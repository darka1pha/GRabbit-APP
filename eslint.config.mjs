// Shared ESLint config for the whole workspace. Every package's `lint` script runs `eslint .`,
// and ESLint finds this file by walking up from the files it checks.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/build/**',
      '**/release/**',
      '**/coverage/**',
      '**/dist-ci/**',
      '**/.turbo/**',
      '**/.expo/**',
      'apps/mobile/android/**',
      'apps/mobile/ios/**',
      'apps/desktop/resources/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-debugger': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      // `catch {}` is how this codebase marks a failure it deliberately ignores
      'no-empty': ['error', { allowEmptyCatch: true }],
      // File-name and log sanitizers match control characters on purpose
      'no-control-regex': 'off',
      // Ambient typings (e.g. the extension's chrome.* declarations) use declare namespace
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
      // Several modules talk to untyped JSON (yt-dlp output, platform APIs); `any` there is deliberate
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },

  // CommonJS config files (Metro, React Native CLI, Expo plugins)
  {
    files: ['**/*.cjs', 'apps/mobile/*.config.js', 'apps/mobile/plugins/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  // Code that runs in a browser: the desktop renderer, the extension and the mobile app
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}', 'apps/desktop/src/preload/**/*.ts', 'packages/extension/**/*.{ts,js,mjs}'],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
  },
  {
    files: ['apps/mobile/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, __DEV__: 'readonly' } },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'expo-file-system',
              message:
                "Since Expo SDK 54 the old functions on 'expo-file-system' typecheck but throw at runtime. Import them from 'expo-file-system/legacy'.",
            },
            { name: 'expo-av', message: 'expo-av is no longer part of the Expo SDK. Use expo-video or expo-audio.' },
          ],
        },
      ],
    },
  },

  // React components
  {
    files: ['apps/desktop/src/renderer/**/*.tsx', 'apps/desktop/src/renderer/**/*.ts', 'apps/mobile/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },

  // The GitHub Pages site
  {
    files: ['docs/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
  },

  // Type declaration files describe shapes; their parameters are not "used"
  {
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },

  // Tests may use loose typing and non-null assertions freely
  {
    files: ['**/tests/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  }
);
