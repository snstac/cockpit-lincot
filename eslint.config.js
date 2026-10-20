// ESLint flat config (ESLint >= 9). Port of the former .eslintrc.json:
// neostandard replaces eslint-config-standard{,-jsx}, @eslint-react replaces
// eslint-plugin-react / standard-react (no ESLint 10 support upstream), and
// @stylistic carries the formatting rules that used to live in core.
// react/jsx-indent has no non-deprecated equivalent; @stylistic/indent
// covers JSX indentation.

import js from '@eslint/js';
import eslintReact from '@eslint-react/eslint-plugin';
import neostandard from 'neostandard';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
    {
        ignores: ['node_modules/', 'pkg/', 'dist/', 'out/', 'coverage/'],
    },

    js.configs.recommended,

    ...neostandard({ ts: true }),

    {
        ...eslintReact.configs['recommended-typescript'],
        files: ['**/*.jsx', '**/*.tsx'],
    },

    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                require: 'readonly',
                module: 'readonly',
            },
        },
        plugins: {
            '@eslint-react': eslintReact,
            'react-hooks': reactHooks,
        },
        rules: {
            '@stylistic/indent': ['error', 4,
                {
                    ObjectExpression: 'first',
                    CallExpression: { arguments: 'first' },
                    MemberExpression: 2,
                    ignoredNodes: ['JSXAttribute']
                }],
            '@stylistic/newline-per-chained-call': ['error', { ignoreChainWithDepth: 2 }],
            'no-var': 'error',
            '@stylistic/lines-between-class-members': ['error', 'always', { exceptAfterSingleLine: true }],
            'prefer-promise-reject-errors': ['error', { allowEmptyReject: true }],
            '@stylistic/semi': ['error', 'always', { omitLastInOneLineBlock: true }],

            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'error',

            camelcase: 'off',
            '@stylistic/comma-dangle': 'off',
            curly: 'off',
            '@stylistic/jsx-quotes': 'off',
            '@stylistic/key-spacing': 'off',
            'no-console': 'off',
            '@stylistic/quotes': 'off',
            '@stylistic/jsx-curly-spacing': 'off',
            '@stylistic/jsx-indent-props': 'off',
            '@eslint-react/jsx-no-useless-fragment': 'error',
            // useRef names like logFollowProcess predate the plugin
            '@eslint-react/naming-convention-ref-name': 'off',
            '@stylistic/space-before-function-paren': 'off',
            'n/no-callback-literal': 'off',
        },
    },

    // TypeScript sources and tests: typescript-eslint's recommended set on
    // top of neostandard, as the old "overrides" block did.
    ...tseslint.configs.recommended.map(config => ({
        ...config,
        files: ['**/*.ts', '**/*.tsx'],
    })),

    // build.js runs under node, not in the browser
    {
        files: ['build.js', 'eslint.config.js', 'vitest.config.ts'],
        languageOptions: { globals: globals.node },
    },
];
