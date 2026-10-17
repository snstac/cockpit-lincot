// @vitest-environment jsdom
/*
 * Copyright Sensors & Signals LLC https://www.snstac.com/
 */

import React from 'react';
import { act } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

vi.mock('./app.jsx', () => ({
    Application: () => <div data-testid="application-stub">stub app</div>,
}));

// index.tsx registers its DOMContentLoaded listener at import time; it only
// looks up #app when the event fires, so the container is created afterwards.
import './index';

beforeAll(() => {
    document.body.innerHTML = '<div id="app"></div>';
});

afterAll(() => {
    document.body.innerHTML = '';
});

describe('index entry point', () => {
    // one test: the listener is registered once per module load, so the
    // before/after states must be checked in order
    test('mounts <Application /> into #app only once DOMContentLoaded fires', async () => {
        expect(document.getElementById('app')?.childNodes.length).toBe(0);
        expect(document.querySelector('[data-testid="application-stub"]')).toBeNull();

        await act(async () => {
            document.dispatchEvent(new Event('DOMContentLoaded'));
        });

        const stub = document.querySelector('#app [data-testid="application-stub"]');
        expect(stub).not.toBeNull();
        expect(stub?.textContent).toBe('stub app');
    });
});
