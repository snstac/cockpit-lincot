// @vitest-environment jsdom
/*
 * Copyright Sensors & Signals LLC https://www.snstac.com/
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import cockpit, { FakeSpawn, ProcessError, mock } from './test/cockpit-mock';
import { Application } from './app';
import { CONF_PARAMS } from './conf';

type SharedModule = typeof import('@snstac/cockpit-shared');
type ToastFn = (t: import('@snstac/cockpit-shared').ToastMessage) => void;
type PathsFn = (paths: { cert?: string; key?: string; ca?: string }) => void;

vi.mock('@snstac/cockpit-shared', async importOriginal => {
    const actual = await importOriginal<SharedModule>();
    return {
        ...actual,
        ServiceManagementCard: ({ onToast }: { onToast: ToastFn }) => (
            <div data-testid="service-card">
                <button type="button" onClick={() => onToast({ variant: 'warning', title: 'Service card toast' })}>
                    service-toast
                </button>
            </div>
        ),
        TlsUploadCard: ({ onToast, onInstalledPaths }: { onToast: ToastFn; onInstalledPaths: PathsFn }) => (
            <div data-testid="tls-card">
                <button type="button" onClick={() => onToast({ variant: 'success', title: 'TLS card toast' })}>
                    tls-toast
                </button>
                <button
                    type="button"
                    onClick={() =>
                        onInstalledPaths({ cert: '/etc/lincot/tls/c.pem', key: '/etc/lincot/tls/k.pem', ca: '/etc/lincot/tls/ca.pem' })}
                >
                    tls-install-all
                </button>
                <button type="button" onClick={() => onInstalledPaths({ ca: '/etc/lincot/tls/only-ca.pem' })}>
                    tls-install-ca
                </button>
            </div>
        ),
    };
});

const CONFIG_FILE = '/etc/default/lincot';

beforeEach(() => {
    mock.reset();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

/* --- helpers --- */

function field(key: string): HTMLInputElement | HTMLSelectElement {
    const el = document.getElementById(`envvar-input-${key}`);
    if (!el)
        throw new Error(`no input for ${key}`);
    return el as HTMLInputElement | HTMLSelectElement;
}

function change(key: string, value: string): void {
    fireEvent.change(field(key), { target: { value } });
}

/** Text content of every alert title, e.g. 'Success alert:Configuration saved.' */
function alertTitles(): string[] {
    return Array.from(document.querySelectorAll('.pf-v6-c-alert__title')).map(el => el.textContent ?? '');
}

function expectToast(variant: string, title: string): void {
    expect(alertTitles()).toContain(`${variant} alert:${title}`);
}

function clickButton(name: string): void {
    fireEvent.click(screen.getByRole('button', { name }));
}

async function flush(): Promise<void> {
    await act(async () => {
        for (let i = 0; i < 5; i++)
            await Promise.resolve();
    });
}

async function renderApp(): Promise<ReturnType<typeof render>> {
    const r = render(<Application />);
    await waitFor(() => expect(mock.state.fileHandles.some(f => f.read.mock.calls.length > 0)).toBe(true));
    await flush();
    return r;
}

function configTitle(): string {
    const header = document.getElementById('lincot-config-expand')!.closest('.pf-v6-c-card__header')!;
    return header.textContent ?? '';
}

function logsPre(): HTMLElement {
    // the log <pre> directly follows the row of log buttons
    return screen.getByRole('button', { name: 'Show Logs' }).parentElement!.nextElementSibling as HTMLElement;
}

async function save(): Promise<void> {
    clickButton('Validate & Save');
    await flush();
}

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

    test('an existing file populates the form and the Advanced card shows its raw contents', async () => {
        const content = '# my config\nCOT_URL=tcp://10.0.0.1:8087\nexport CALLSIGN="My Call"\nDEBUG=true\nFOO=bar\n';
        mock.state.files.set(CONFIG_FILE, content);

        await renderApp();

        expect(field('COT_URL').value).toBe('tcp://10.0.0.1:8087');
        expect(field('CALLSIGN').value).toBe('My Call');
        expect(field('DEBUG').value).toBe('true');
        // values not in the file keep their defaults
        expect(field('POLL_INTERVAL').value).toBe('61');
        expect(configTitle()).not.toMatch(/unsaved changes/);

        fireEvent.click(document.getElementById('lincot-advanced-expand')!);
        const pre = screen.getByText(/Raw Configuration File Contents/).parentElement!.querySelector('pre')!;
        expect(pre.textContent).toBe(content);
    });

    test('unknown keys, comments and export prefixes are preserved on save', async () => {
        mock.state.files.set(CONFIG_FILE, '# keep me\nFOO=bar\nexport COT_URL=tcp://10.0.0.1:8087\nnot an assignment\n');
        await renderApp();

        change('CALLSIGN', 'ALPHA');
        await save();

        expect(mock.state.files.get(CONFIG_FILE)).toBe(
            '# keep me\nFOO=bar\nexport COT_URL=tcp://10.0.0.1:8087\nnot an assignment\n\n' +
            '# Added by Cockpit LINCOT\nCALLSIGN=ALPHA\n'
        );
    });

    test('a read error shows a warning alert with the error message', async () => {
        mock.state.readError = new Error('permission denied');
        await renderApp();

        expectToast('Warning', 'Failed to read configuration file: permission denied.');
        expect(field('COT_URL').value).toBe('udp+wo://239.2.3.1:6969');
    });

    test('a read error with a non-Error value is reported as a string', async () => {
        mock.state.readError = 'disk on fire' as unknown as Error;
        await renderApp();

        expectToast('Warning', 'Failed to read configuration file: disk on fire.');
    });

    test('a successful reload clears a previous read error', async () => {
        mock.state.readError = new Error('busy');
        await renderApp();
        expectToast('Warning', 'Failed to read configuration file: busy.');

        mock.state.readError = null;
        await act(async () => {
            mock.fireWatch(CONFIG_FILE, 'COT_URL=tcp://1.2.3.4:1\n');
        });
        await flush();

        expect(alertTitles().some(t => t.includes('Failed to read'))).toBe(false);
        expect(field('COT_URL').value).toBe('tcp://1.2.3.4:1');
    });
});

describe('file watcher', () => {
    test('an external change reloads the form when there are no unsaved edits', async () => {
        mock.state.files.set(CONFIG_FILE, 'CALLSIGN=ONE\n');
        await renderApp();
        expect(field('CALLSIGN').value).toBe('ONE');

        await act(async () => {
            mock.fireWatch(CONFIG_FILE, 'CALLSIGN=TWO\n');
        });
        await flush();

        expect(field('CALLSIGN').value).toBe('TWO');
    });

    test('an external change does not clobber unsaved edits', async () => {
        mock.state.files.set(CONFIG_FILE, 'CALLSIGN=ONE\n');
        await renderApp();

        change('CALLSIGN', 'MINE');
        await act(async () => {
            mock.fireWatch(CONFIG_FILE, 'CALLSIGN=THEIRS\n');
        });
        await flush();

        expect(field('CALLSIGN').value).toBe('MINE');
        expect(configTitle()).toMatch(/\(unsaved changes\)/);
    });

    test('a read error during an external change does not clobber unsaved edits', async () => {
        await renderApp();

        change('CALLSIGN', 'MINE');
        mock.state.readError = new Error('gone');
        await act(async () => {
            mock.fireWatch(CONFIG_FILE, 'CALLSIGN=THEIRS\n');
        });
        await flush();

        expect(field('CALLSIGN').value).toBe('MINE');
        expect(alertTitles().some(t => t.includes('Failed to read'))).toBe(false);
    });

    test('the watcher is removed on unmount', async () => {
        const { unmount } = await renderApp();
        expect(mock.state.watchers.get(CONFIG_FILE)?.length).toBe(1);

        unmount();

        expect(mock.state.watchers.get(CONFIG_FILE)?.length).toBe(0);
    });

    test('unmount copes with a watch() that returns no handle', async () => {
        const original = cockpit.file.getMockImplementation()!;
        cockpit.file.mockImplementation((path: string) => {
            const handle = original(path);
            handle.watch = vi.fn(() => undefined);
            return handle;
        });
        try {
            const { unmount } = await renderApp();
            expect(() => unmount()).not.toThrow();
        } finally {
            cockpit.file.mockImplementation(original);
        }
    });
});

describe('editing fields', () => {
    test('text, number and boolean inputs update and mark the form dirty', async () => {
        await renderApp();
        expect(configTitle()).not.toMatch(/unsaved changes/);

        change('CALLSIGN', 'BRAVO');
        change('POLL_INTERVAL', '30');
        change('DEBUG', 'true');

        expect(field('CALLSIGN').value).toBe('BRAVO');
        expect(field('POLL_INTERVAL').value).toBe('30');
        expect(field('POLL_INTERVAL').getAttribute('type')).toBe('number');
        expect(field('POLL_INTERVAL').getAttribute('min')).toBe('1');
        expect(field('POLL_INTERVAL').getAttribute('max')).toBe('86400');
        expect(field('STATIC_LAT').getAttribute('min')).toBeNull();
        expect(field('CALLSIGN').getAttribute('type')).toBe('text');
        expect(field('DEBUG').tagName).toBe('SELECT');
        expect(field('DEBUG').value).toBe('true');
        expect(configTitle()).toMatch(/\(unsaved changes\)/);
        expect(screen.getByText(/Range: 1 - 86400/)).toBeTruthy();
    });

    test('a value failing the regex shows "Invalid value"', async () => {
        await renderApp();

        change('COCKPIT_URL', 'ftp://nope');

        expect(screen.getByText('Invalid value')).toBeTruthy();

        change('COCKPIT_URL', 'https://pi.local:9090');
        expect(screen.queryByText('Invalid value')).toBeNull();
    });

    test('a number outside its range shows the range message', async () => {
        await renderApp();

        change('POLL_INTERVAL', '0');
        expect(screen.getByText('Value must be between 1 and 86400')).toBeTruthy();

        change('POLL_INTERVAL', '90000');
        expect(screen.getByText('Value must be between 1 and 86400')).toBeTruthy();

        change('POLL_INTERVAL', '5');
        expect(screen.queryByText('Value must be between 1 and 86400')).toBeNull();
    });

    test('the required COT_URL may not be empty', async () => {
        await renderApp();

        change('COT_URL', '');

        expect(screen.getByText('Invalid value')).toBeTruthy();
    });

    test('optional fields may be left empty', async () => {
        mock.state.files.set(CONFIG_FILE, 'COCKPIT_URL=https://x.local\nPOLL_INTERVAL=10\n');
        await renderApp();

        change('COCKPIT_URL', '');
        change('POLL_INTERVAL', '');

        expect(screen.queryByText('Invalid value')).toBeNull();
        expect(screen.queryByText(/Value must be between/)).toBeNull();
    });

    describe('enum parameters', () => {
        // CONF_PARAMS currently has no enum entries; add temporary ones to
        // exercise the enum rendering and validation paths.
        beforeEach(() => {
            CONF_PARAMS.TEST_MODE = {
                type: 'enum',
                description: 'Test mode',
                defaultValue: 'alpha',
                options: ['alpha', 'beta'],
                required: false,
            };
            CONF_PARAMS.TEST_ENUM_NO_OPTIONS = {
                type: 'enum',
                description: 'Enum without options',
                defaultValue: '',
                required: false,
            };
        });

        afterEach(() => {
            delete CONF_PARAMS.TEST_MODE;
            delete CONF_PARAMS.TEST_ENUM_NO_OPTIONS;
        });

        test('renders a select of the options and validates against them', async () => {
            await renderApp();

            const sel = field('TEST_MODE') as HTMLSelectElement;
            expect(sel.tagName).toBe('SELECT');
            expect(Array.from(sel.options).map(o => o.value)).toEqual(['alpha', 'beta']);
            expect(screen.getByText(/Options: alpha, beta/)).toBeTruthy();

            change('TEST_MODE', 'beta');
            expect(sel.value).toBe('beta');
            expect(screen.queryByText('Invalid option')).toBeNull();

            // an enum without options falls back to a plain text input
            expect(field('TEST_ENUM_NO_OPTIONS').tagName).toBe('INPUT');
        });

        test('a value that is not an option fails validation and blocks saving', async () => {
            mock.state.files.set(CONFIG_FILE, 'COT_URL=tcp://1.2.3.4:1\n');
            await renderApp();
            // add a stray <option> so the select can hold a value outside the definition
            const sel = field('TEST_MODE') as HTMLSelectElement;
            const opt = document.createElement('option');
            opt.value = 'gamma';
            sel.appendChild(opt);
            change('TEST_MODE', 'gamma');

            expect(screen.getByText('Invalid option')).toBeTruthy();
            await save();
            expectToast('Danger', 'Fix validation errors before saving.');
            expect(mock.state.files.get(CONFIG_FILE)).toBe('COT_URL=tcp://1.2.3.4:1\n');
        });
    });
});

describe('saving', () => {
    test('validation errors block the save and show a danger toast', async () => {
        await renderApp();

        change('COT_URL', 'garbage');
        await save();

        expectToast('Danger', 'Fix validation errors before saving.');
        expect(mock.state.files.has(CONFIG_FILE)).toBe(false);
        expect(mock.state.fileHandles.some(f => f.replace.mock.calls.length > 0)).toBe(false);
    });

    test('a successful save writes the file, shows a success toast and clears the dirty marker', async () => {
        await renderApp();

        change('CALLSIGN', 'CHARLIE');
        expect(configTitle()).toMatch(/\(unsaved changes\)/);
        await save();

        const written = mock.state.files.get(CONFIG_FILE)!;
        // (leading blank lines are not significant for an EnvironmentFile)
        expect(written.trimStart()).toBe('# Added by Cockpit LINCOT\nCOT_URL=udp+wo://239.2.3.1:6969\nCALLSIGN=CHARLIE\n');
        expect(written.endsWith('\n')).toBe(true);
        expectToast('Success', 'Configuration saved.');
        expect(configTitle()).not.toMatch(/unsaved changes/);
        expect(field('CALLSIGN').value).toBe('CHARLIE');

        fireEvent.click(document.getElementById('lincot-advanced-expand')!);
        const pre = screen.getByText(/Raw Configuration File Contents/).parentElement!.querySelector('pre')!;
        expect(pre.textContent).toContain('CALLSIGN=CHARLIE');
        expect(mock.spawnsFor('systemctl restart')).toHaveLength(0);
    });

    test('a file already ending in a newline does not get a second one', async () => {
        mock.state.files.set(CONFIG_FILE, 'COT_URL=tcp://10.0.0.1:1\nCALLSIGN=A\n');
        await renderApp();

        change('CALLSIGN', 'B');
        await save();

        expect(mock.state.files.get(CONFIG_FILE)).toBe('COT_URL=tcp://10.0.0.1:1\nCALLSIGN=B\n');
    });

    test('a second save after a successful one keeps the file stable', async () => {
        mock.state.files.set(CONFIG_FILE, 'COT_URL=tcp://10.0.0.1:1\n');
        await renderApp();

        change('CALLSIGN', 'B');
        await save();
        const first = mock.state.files.get(CONFIG_FILE);
        await save();

        expect(mock.state.files.get(CONFIG_FILE)).toBe(first);
    });

    test('save failure shows a danger toast', async () => {
        await renderApp();
        mock.state.replaceError = new Error('read-only file system');

        change('CALLSIGN', 'DELTA');
        await save();

        expectToast('Danger', 'Failed to update configuration file: read-only file system');
        expect(configTitle()).toMatch(/\(unsaved changes\)/);
        expect(screen.getByRole('button', { name: 'Validate & Save' }).hasAttribute('disabled')).toBe(false);
    });

    test('save failure with a non-Error value is reported as a string', async () => {
        await renderApp();
        mock.state.replaceError = 'nope' as unknown as Error;

        await save();

        expectToast('Danger', 'Failed to update configuration file: nope');
    });

    test('save and restart restarts the service; the button is busy meanwhile', async () => {
        await renderApp();
        fireEvent.click(document.getElementById('lincot-save-restart')!);
        expect((document.getElementById('lincot-save-restart') as HTMLInputElement).checked).toBe(true);

        await save();

        const restarts = mock.spawnsFor('systemctl restart lincot');
        expect(restarts).toHaveLength(1);
        const busy = screen.getByRole('button', { name: 'Saving…' });
        expect(busy.hasAttribute('disabled')).toBe(true);
        expect(mock.state.files.has(CONFIG_FILE)).toBe(true);

        await act(async () => {
            restarts[0].resolve('');
        });
        await flush();

        expectToast('Success', 'Configuration saved and service restarted.');
        expect(screen.getByRole('button', { name: 'Validate & Save' }).hasAttribute('disabled')).toBe(false);
    });

    test('a failed restart shows a warning toast', async () => {
        mock.onSpawn(proc => {
            if (proc.args[1] === 'restart')
                proc.reject(new ProcessError({ message: 'unit not found' }));
        });
        await renderApp();
        fireEvent.click(document.getElementById('lincot-save-restart')!);

        await save();

        expectToast('Warning', 'Saved, but restart failed: unit not found');
        expect(mock.state.files.has(CONFIG_FILE)).toBe(true);
    });

    test('a failed restart with a non-Error value is reported as a string', async () => {
        mock.onSpawn(proc => {
            if (proc.args[1] === 'restart')
                proc.reject('access denied');
        });
        await renderApp();
        fireEvent.click(document.getElementById('lincot-save-restart')!);

        await save();

        expectToast('Warning', 'Saved, but restart failed: access denied');
    });

    test('unchecking "Restart lincot after save" saves without restarting', async () => {
        await renderApp();
        const box = document.getElementById('lincot-save-restart')!;
        fireEvent.click(box);
        fireEvent.click(box);

        await save();

        expect(mock.spawnsFor('systemctl restart')).toHaveLength(0);
        expectToast('Success', 'Configuration saved.');
    });
});

describe('toasts', () => {
    test('the dismiss button removes the toast', async () => {
        await renderApp();
        change('COT_URL', 'bad');
        await save();
        expectToast('Danger', 'Fix validation errors before saving.');

        fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

        expect(alertTitles()).toHaveLength(0);
    });

    test('toasts from the service and TLS cards are shown', async () => {
        await renderApp();

        clickButton('service-toast');
        expectToast('Warning', 'Service card toast');

        clickButton('tls-toast');
        expectToast('Success', 'TLS card toast');
        expect(alertTitles()).toHaveLength(1);
    });
});

describe('TLS installed paths', () => {
    test('all installed paths fill the TLS fields and mark the form dirty', async () => {
        await renderApp();

        clickButton('tls-install-all');

        expect(field('PYTAK_TLS_CLIENT_CERT').value).toBe('/etc/lincot/tls/c.pem');
        expect(field('PYTAK_TLS_CLIENT_KEY').value).toBe('/etc/lincot/tls/k.pem');
        expect(field('PYTAK_TLS_CLIENT_CAFILE').value).toBe('/etc/lincot/tls/ca.pem');
        expect(configTitle()).toMatch(/\(unsaved changes\)/);
    });

    test('partial paths only set the provided fields', async () => {
        mock.state.files.set(CONFIG_FILE, 'PYTAK_TLS_CLIENT_CERT=/old/cert.pem\n');
        await renderApp();

        clickButton('tls-install-ca');

        expect(field('PYTAK_TLS_CLIENT_CERT').value).toBe('/old/cert.pem');
        expect(field('PYTAK_TLS_CLIENT_KEY').value).toBe('');
        expect(field('PYTAK_TLS_CLIENT_CAFILE').value).toBe('/etc/lincot/tls/only-ca.pem');
        expect(configTitle()).toMatch(/\(unsaved changes\)/);
    });
});

describe('expandable cards', () => {
    test.each([
        ['lincot-config-expand', 'Collapse configuration', 'Expand configuration'],
        ['lincot-debug-expand', 'Expand debug', 'Collapse debug'],
        ['lincot-advanced-expand', 'Expand advanced', 'Collapse advanced'],
    ])('%s toggles its aria-label', async (id, before, after) => {
        await renderApp();
        const btn = document.getElementById(id)!;
        expect(btn.getAttribute('aria-label')).toBe(before);

        fireEvent.click(btn);
        expect(btn.getAttribute('aria-label')).toBe(after);

        fireEvent.click(btn);
        expect(btn.getAttribute('aria-label')).toBe(before);
    });

    test('collapsing the configuration card hides the form', async () => {
        await renderApp();
        fireEvent.click(document.getElementById('lincot-config-expand')!);

        expect(document.getElementById('envvar-input-COT_URL')).toBeNull();
    });
});

describe('debug logs', () => {
    async function openDebug(): Promise<void> {
        await renderApp();
        fireEvent.click(document.getElementById('lincot-debug-expand')!);
    }

    function followProcs(): FakeSpawn[] {
        return mock.spawnsFor('journalctl -u lincot -f');
    }

    test('shows a placeholder before anything is loaded', async () => {
        await openDebug();
        expect(logsPre().textContent).toBe('No logs to display.');
    });

    test('Show Logs displays journalctl output', async () => {
        mock.onSpawn(proc => {
            if (proc.args[0] === 'journalctl')
                proc.resolve('Oct 17 lincot[1]: started\n');
        });
        await openDebug();

        clickButton('Show Logs');
        await flush();

        expect(logsPre().textContent).toBe('Oct 17 lincot[1]: started\n');
        expect(mock.spawnsFor('journalctl -u lincot --no-pager --since today')).toHaveLength(1);
    });

    test('Show Logs with empty output says no logs were found', async () => {
        mock.onSpawn(proc => {
            if (proc.args[0] === 'journalctl')
                proc.resolve('');
        });
        await openDebug();

        clickButton('Show Logs');
        await flush();

        expect(logsPre().textContent).toBe('No logs found for this service.');
    });

    test('Show Logs failure reports an error', async () => {
        mock.onSpawn(proc => {
            if (proc.args[0] === 'journalctl')
                proc.reject(new ProcessError({ exit_status: 1 }));
        });
        await openDebug();

        clickButton('Show Logs');
        await flush();

        expect(logsPre().textContent).toBe('Failed to retrieve service logs.');
    });

    test('Follow Logs streams output; Stop Following closes the process', async () => {
        await openDebug();

        clickButton('Follow Logs');
        expect(followProcs()).toHaveLength(1);
        const proc = followProcs()[0];

        act(() => proc.emit('line 1\n'));
        act(() => proc.emit('line 2\n'));
        expect(logsPre().textContent).toBe('line 1\nline 2\n');

        clickButton('Follow Logs');
        expect(logsPre().textContent).toBe('Already following logs.');
        expect(followProcs()).toHaveLength(1);

        clickButton('Stop Following');
        expect(proc.closed).toBe(true);
        expect(logsPre().textContent).toBe('Stopped following logs.');

        clickButton('Stop Following');
        expect(logsPre().textContent).toBe('Not currently following logs.');
    });

    test('Stop Following when never started says so', async () => {
        await openDebug();

        clickButton('Stop Following');

        expect(logsPre().textContent).toBe('Not currently following logs.');
    });

    test('a failing follow process reports an error and can be restarted', async () => {
        await openDebug();

        clickButton('Follow Logs');
        act(() => followProcs()[0].reject(new ProcessError({ problem: 'not-found' })));
        expect(logsPre().textContent).toBe('Failed to follow logs.');

        clickButton('Follow Logs');
        expect(followProcs()).toHaveLength(2);
    });

    test('a follow process that exits allows following again', async () => {
        await openDebug();

        clickButton('Follow Logs');
        act(() => followProcs()[0].emit('bye\n'));
        act(() => followProcs()[0].resolve(''));
        expect(logsPre().textContent).toBe('bye\n');

        clickButton('Follow Logs');
        expect(followProcs()).toHaveLength(2);
        expect(logsPre().textContent).toBe('No logs to display.');
    });

    test('unmount closes a following process', async () => {
        const { unmount } = await renderApp();
        fireEvent.click(document.getElementById('lincot-debug-expand')!);
        clickButton('Follow Logs');
        const proc = followProcs()[0];

        unmount();

        expect(proc.closed).toBe(true);
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

    function statusSpawns(): FakeSpawn[] {
        return mock.spawnsFor('systemctl status lincot --no-pager');
    }

    test('shows Loading... then the status output of a running service', async () => {
        await renderApp();
        fireEvent.click(document.getElementById('lincot-debug-expand')!);
        expect(screen.getByText('Loading...')).toBeTruthy();

        await act(async () => {
            statusSpawns()[0].resolve('Active: active (running)');
        });

        expect(screen.getByText('Active: active (running)')).toBeTruthy();
    });

    test('a failure without output reports an error', async () => {
        mock.onSpawn(proc => {
            if (proc.args[1] === 'status')
                proc.reject(new ProcessError({ problem: 'access-denied' }));
        });
        await renderApp();
        fireEvent.click(document.getElementById('lincot-debug-expand')!);
        await flush();

        expect(screen.getByText('Failed to get status output.')).toBeTruthy();
    });

    test('status is refreshed every 4 seconds', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        let n = 0;
        mock.onSpawn(proc => {
            if (proc.args[1] === 'status')
                proc.resolve(`status #${++n}`);
        });
        await renderApp();
        fireEvent.click(document.getElementById('lincot-debug-expand')!);
        await flush();
        expect(screen.getByText('status #1')).toBeTruthy();

        await act(async () => {
            vi.advanceTimersByTime(3999);
        });
        expect(statusSpawns()).toHaveLength(1);

        await act(async () => {
            vi.advanceTimersByTime(1);
        });
        await flush();
        expect(statusSpawns()).toHaveLength(2);
        expect(screen.getByText('status #2')).toBeTruthy();

        await act(async () => {
            vi.advanceTimersByTime(8000);
        });
        expect(statusSpawns()).toHaveLength(4);
    });

    test('stops polling and ignores late results once unmounted', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            await renderApp();
            const toggle = document.getElementById('lincot-debug-expand')!;
            fireEvent.click(toggle);
            expect(statusSpawns()).toHaveLength(1);
            const ok = statusSpawns()[0];

            fireEvent.click(document.getElementById('lincot-debug-expand')!);
            // collapsing the card unmounts StatusOutput
            expect(screen.queryByText('Loading...')).toBeNull();

            await act(async () => {
                ok.resolve('late output');
            });
            await act(async () => {
                vi.advanceTimersByTime(12000);
            });

            expect(statusSpawns()).toHaveLength(1);
            expect(errors).not.toHaveBeenCalled();

            // late rejection after unmount is ignored too
            fireEvent.click(toggle);
            const second = statusSpawns()[1];
            fireEvent.click(toggle);
            await act(async () => {
                second.reject(new ProcessError({ exit_status: 3 }), 'late status');
            });
            fireEvent.click(toggle);
            expect(screen.queryByText('late status')).toBeNull();
            expect(screen.queryByText('late output')).toBeNull();
            expect(errors).not.toHaveBeenCalled();
        } finally {
            errors.mockRestore();
        }
    });
});
