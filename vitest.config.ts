import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const stub = (name: string) => fileURLToPath(new URL(`./src/test/${name}`, import.meta.url));

export default defineConfig({
    resolve: {
        // pkg/lib modules are resolved through esbuild's nodePaths at build
        // time; in tests they are replaced with in-memory fakes.
        alias: {
            cockpit: stub('cockpit-mock.ts'),
            'cockpit-dark-theme': stub('empty.ts'),
        },
    },
    test: {
        environment: 'node',
        // CI runs `make ci` with NODE_ENV=production for the bundle; without
        // this the tests would load React's production build, where act() and
        // the development warnings are unavailable.
        env: { NODE_ENV: 'test' },
        include: ['src/**/*.test.{ts,tsx}'],
        passWithNoTests: true,
        server: {
            deps: {
                // PatternFly's ESM imports .css files and cockpit-shared ships
                // TypeScript sources; both must go through Vite's transform.
                inline: [/@patternfly\//, /@snstac\/cockpit-shared/],
            },
        },
        coverage: {
            provider: 'v8',
            include: ['src/**/*.{ts,tsx}'],
            exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
            reporter: ['text', 'json-summary'],
            thresholds: {
                statements: 90,
                branches: 90,
                functions: 90,
                lines: 90,
            },
        },
    },
});
