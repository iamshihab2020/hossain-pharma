const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true },
    },
    rules: {
      // S7: zero `any` in src/.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',

      // PRD 6.4 acceptance criterion 2. The raw handle carries no tenant
      // context, so a query made through it silently ignores RLS. Written now,
      // in Phase 0, because a rule added after the first violation is a rule
      // that gets suppressed.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@nexmarket/db',
              importNames: ['db', 'pool'],
              message:
                'Import withTenant instead. The raw db/pool handle bypasses RLS tenant context. See PRD 6.4 criterion 2.',
            },
          ],
        },
      ],
    },
  },
  { ignores: ['dist/**', '.next/**', 'archive/**', 'node_modules/**', 'coverage/**'] },
);
