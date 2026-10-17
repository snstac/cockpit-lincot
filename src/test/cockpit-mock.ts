/*
 * Copyright Sensors & Signals LLC https://www.snstac.com/
 *
 * In-memory stand-in for pkg/lib/cockpit.js used by the unit tests.
 *
 * cockpit.spawn() returns a jQuery-style deferred: on a non-zero exit it
 * rejects with (ProcessError, stdout), and .then()/.catch() handlers receive
 * both arguments. FakeSpawn reproduces that so code relying on the second
 * argument can be tested.
 */

import { vi } from 'vitest';

export class ProcessError extends Error {
    problem: string | null;
    exit_status: number | null;
    exit_signal: number | null;

    constructor(options: { problem?: string; exit_status?: number; message?: string } = {}) {
        super(options.message ?? (options.problem ?? `exited with code ${options.exit_status}`));
        this.problem = options.problem ?? null;
        this.exit_status = options.exit_status ?? null;
        this.exit_signal = null;
    }
}

type Settled = { ok: true; data: string } | { ok: false; error: unknown; data: string };
type Handler = (...args: unknown[]) => unknown;

export class FakeSpawn {
    args: string[];
    options: Record<string, unknown> | undefined;
    closed = false;
    private settled: Settled | null = null;
    private waiters: Array<() => void> = [];
    private streamCb: ((data: string) => void) | null = null;
    private doneCbs: Handler[] = [];
    private failCbs: Handler[] = [];

    constructor(args: string[], options?: Record<string, unknown>) {
        this.args = args;
        this.options = options;
    }

    /* --- test controls --- */
    resolve(data = ''): void {
        this.settle({ ok: true, data });
    }

    reject(error: unknown, data = ''): void {
        this.settle({ ok: false, error, data });
    }

    emit(data: string): void {
        this.streamCb?.(data);
    }

    private settle(s: Settled): void {
        if (this.settled)
            return;
        this.settled = s;
        if (s.ok)
            this.doneCbs.forEach(cb => cb(s.data));
        else
            this.failCbs.forEach(cb => cb(s.error, s.data));
        this.waiters.splice(0).forEach(w => w());
    }

    /* --- cockpit API --- */
    then(onOk?: Handler | null, onErr?: Handler | null): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const run = () => {
                const s = this.settled!;
                try {
                    if (s.ok)
                        resolve(onOk ? onOk(s.data) : s.data);
                    else if (onErr)
                        resolve(onErr(s.error, s.data));
                    else
                        reject(s.error);
                } catch (e) {
                    reject(e);
                }
            };
            if (this.settled)
                queueMicrotask(run);
            else
                this.waiters.push(run);
        });
    }

    catch(onErr: Handler): Promise<unknown> {
        return this.then(null, onErr);
    }

    stream(cb: (data: string) => void): this {
        this.streamCb = cb;
        return this;
    }

    done(cb: Handler): this {
        this.doneCbs.push(cb);
        return this;
    }

    fail(cb: Handler): this {
        this.failCbs.push(cb);
        return this;
    }

    close(): void {
        this.closed = true;
        this.resolve('');
    }
}

export type SpawnHandler = (spawn: FakeSpawn) => void;

export type FakeFile = {
    path: string;
    read: ReturnType<typeof vi.fn>;
    replace: ReturnType<typeof vi.fn>;
    watch: ReturnType<typeof vi.fn>;
};

const state: {
    spawns: FakeSpawn[];
    spawnHandler: SpawnHandler | null;
    files: Map<string, string | null>;
    fileHandles: FakeFile[];
    watchers: Map<string, Array<(content: string | null) => void>>;
    readError: Error | null;
    replaceError: Error | null;
} = {
    spawns: [],
    spawnHandler: null,
    files: new Map(),
    fileHandles: [],
    watchers: new Map(),
    readError: null,
    replaceError: null,
};

function file(path: string): FakeFile {
    const handle: FakeFile = {
        path,
        read: vi.fn(async () => {
            if (state.readError)
                throw state.readError;
            // cockpit resolves read() with null when the file does not exist
            return state.files.has(path) ? state.files.get(path)! : null;
        }),
        replace: vi.fn(async (content: string) => {
            if (state.replaceError)
                throw state.replaceError;
            state.files.set(path, content);
        }),
        watch: vi.fn((cb: (content: string | null) => void) => {
            const list = state.watchers.get(path) ?? [];
            list.push(cb);
            state.watchers.set(path, list);
            return {
                remove: vi.fn(() => {
                    state.watchers.set(path, (state.watchers.get(path) ?? []).filter(w => w !== cb));
                }),
            };
        }),
    };
    state.fileHandles.push(handle);
    return handle;
}

function spawn(args: string[], options?: Record<string, unknown>): FakeSpawn {
    const proc = new FakeSpawn(args, options);
    state.spawns.push(proc);
    state.spawnHandler?.(proc);
    return proc;
}

const cockpit = {
    gettext: (s: string) => s,
    spawn: vi.fn(spawn),
    file: vi.fn(file),
    dbus: vi.fn(),
    ProcessError,
};

export default cockpit;

/* --- helpers for tests --- */
export const mock = {
    state,
    reset(): void {
        state.spawns = [];
        state.spawnHandler = null;
        state.files = new Map();
        state.fileHandles = [];
        state.watchers = new Map();
        state.readError = null;
        state.replaceError = null;
        cockpit.spawn.mockClear();
        cockpit.file.mockClear();
    },
    /** Called synchronously for every new spawn, e.g. to auto-resolve it. */
    onSpawn(handler: SpawnHandler | null): void {
        state.spawnHandler = handler;
    },
    spawnsFor(cmd: string): FakeSpawn[] {
        return state.spawns.filter(s => s.args.join(' ').startsWith(cmd));
    },
    /** Simulate the file changing on disk; fires registered watchers. */
    fireWatch(path: string, content: string | null): void {
        if (content === null)
            state.files.delete(path);
        else
            state.files.set(path, content);
        (state.watchers.get(path) ?? []).forEach(cb => cb(content));
    },
};
