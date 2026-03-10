import js from '@eslint/js';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default [
  js.configs.recommended,
  {
    plugins: { obsidianmd },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        app: 'readonly',
        module: 'readonly',
        require: 'readonly',
        console: 'readonly',
        document: 'readonly',
        MouseEvent: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      // These rules require TypeScript type information — not available in plain JS plugins
      'obsidianmd/no-plugin-as-component': 'off',
      'obsidianmd/no-view-references-in-plugin': 'off',
      'obsidianmd/prefer-file-manager-trash-file': 'off',
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
  {
    ignores: ['node_modules/', '*.mjs'],
  },
];
