module.exports = {
  root: true,
  ignorePatterns: ['bld', '.bld-cache'],
  extends: ['eslint:recommended'],
  env: {
    node: true,
    es2020: true,
  },
  overrides: [
    {
      files: ['**/*.{ts,tsx}'],
      extends: ['plugin:@mufan/default'],
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
  ],
};
