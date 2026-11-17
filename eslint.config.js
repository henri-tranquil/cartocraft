// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = defineConfig([
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: ['app', 'cc'],
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: ['app', 'cc'],
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    // Architecture rule: the domain is pure TypeScript (testable, worker-safe, portable).
    files: ['src/app/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@angular/*', 'rxjs', 'rxjs/*'], message: 'Le domaine ne dépend pas d\'Angular.' },
            { group: ['**/application/**', '**/infrastructure/**', '**/rendering/**', '**/ui/**'], message: 'Dépendances à sens unique : le domaine ne dépend de rien.' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {},
  },
]);
