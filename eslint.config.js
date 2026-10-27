// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'tools/**'],
  },
  {
    rules: {
      // decimal.js only provides a default export in its ESM build
      'import/no-named-as-default': 'off',
    },
  },
]);
