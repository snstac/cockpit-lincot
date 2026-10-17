// @vitest-environment jsdom
/*
 * Copyright Sensors & Signals LLC https://www.snstac.com/
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ProcessError, mock } from './test/cockpit-mock';
import { Application } from './app';

vi.mock('@snstac/cockpit-shared', async importOriginal => {
    const actual = await importOriginal<typeof import('@snstac/cockpit-shared')>();
    return {
        ...actual,
        ServiceManagementCard: () => <div data-testid="service-card" />,
        TlsUploadCard: () => <div data-testid="tls-card" />,
    };
});

const CONFIG_FILE = '/etc/default/lincot';

beforeEach(() => {
    mock.reset();
});

afterEach(() => {
    cleanup();
});

describe('loading the configuration file', () => {
    test('a missing config file is not reported as a read failure', async () => {
        // cockpit.file().read() resolves with null for a nonexistent file
        render(<Application />);

        await waitFor(() => expect(mock.state.fileHandles.some(f => f.read.mock.calls.length > 0)).toBe(true));
        await act(async () => {});

        expect(screen.queryByText(/Failed to read configuration file/)).toBeNull();
        expect((document.getElementById('envvar-input-COT_URL') as HTMLInputElement).value)
                .toBe('udp+wo://239.2.3.1:6969');
        expect(mock.state.files.has(CONFIG_FILE)).toBe(false);
    });
});

describe('status output', () => {
    test('shows systemctl output for an inactive service (exit status 3)', async () => {
        const status = '○ lincot.service - LINCOT\n     Active: inactive (dead)\n';
        mock.onSpawn(proc => {
            if (proc.args[0] === 'systemctl' && proc.args[1] === 'status')
                proc.reject(new ProcessError({ exit_status: 3 }), status);
        });

        render(<Application />);
        fireEvent.click(document.getElementById('lincot-debug-expand')!);

        await waitFor(() => expect(screen.getByText(/Active: inactive \(dead\)/)).toBeTruthy());
        expect(screen.queryByText('Failed to get status output.')).toBeNull();
    });
});
