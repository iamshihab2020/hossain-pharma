import config from '@nexmarket/config/eslint';

export default [
  ...config,
  {
    // components/ui holds 32 vendored shadcn/ui primitives salvaged per PRD
    // 12.1. They are upstream code, regenerable by the shadcn CLI, and are not
    // ours to restyle. Type-checking still covers them; only lint opinions are
    // relaxed. Anything we write lives outside this directory.
    files: ['components/ui/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];
