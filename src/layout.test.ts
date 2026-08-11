import { readFileSync } from 'node:fs';

import { compile } from 'sass';
import { describe, expect, test } from 'vitest';

describe('Cockpit page layout', () => {
    test('provides a viewport-height root scroller', () => {
        const css = compile('src/app.scss', {
            loadPaths: ['pkg/lib', 'node_modules'],
            quietDeps: true,
        }).css;

        expect(css).toMatch(/html,\s*body,\s*#app\s*{[^}]*block-size:\s*100%/s);
        expect(css).toMatch(/#app\s*{[^}]*overflow-y:\s*auto/s);
    });

    test('loads the plugin and shared AryaOS stylesheets', () => {
        const html = readFileSync('src/index.html', 'utf8');

        expect(html).toContain('<link rel="stylesheet" href="index.css">');
        expect(html).toContain('<link href="../../static/branding.css" rel="stylesheet" />');
    });
});
