// @vitest-environment jsdom
/*
 * Copyright Sensors & Signals LLC https://www.snstac.com/
 */

// jsdom: the cockpit-shared barrel also exports PatternFly components whose
// CSS side-effect imports only resolve through the browser-condition build.

import {
    defaultFormFromConf,
    mergeFormValues,
    parseEnvDefault,
    serializeEnvDefault,
} from '@snstac/cockpit-shared';
import { describe, expect, test } from 'vitest';

import { CONF_PARAMS } from './conf';

const VALID_TYPES = ['boolean', 'string', 'number', 'enum', 'path', 'url'];
const ENTRIES = Object.entries(CONF_PARAMS);

const regexFor = (key: string): RegExp => {
    const re = CONF_PARAMS[key]?.validation;
    if (!re)
        throw new Error(`${key} has no validation regex`);
    return re;
};

describe('CONF_PARAMS definitions', () => {
    test.each(ENTRIES)('%s has a description, a valid type and a string default', (_key, def) => {
        expect(typeof def.description).toBe('string');
        expect(def.description.trim()).not.toBe('');
        expect(VALID_TYPES).toContain(def.type);
        expect(typeof def.defaultValue).toBe('string');
    });

    test.each(ENTRIES.filter(([, d]) => d.validation && d.defaultValue !== ''))(
        '%s default passes its own validation',
        (_key, def) => {
            expect(def.validation?.test(def.defaultValue)).toBe(true);
        });

    test.each(ENTRIES.filter(([, d]) => d.type === 'number' && d.range && d.defaultValue !== ''))(
        '%s default lies inside its range',
        (_key, def) => {
            const [min, max] = def.range ?? [0, 0];
            const n = Number(def.defaultValue);
            expect(n).toBeGreaterThanOrEqual(min);
            expect(n).toBeLessThanOrEqual(max);
        });

    test.each(ENTRIES.filter(([, d]) => d.type === 'boolean'))(
        '%s boolean default is true/false',
        (_key, def) => {
            expect(['true', 'false']).toContain(def.defaultValue);
        });

    test('every number and boolean entry carries a validation regex', () => {
        for (const [key, def] of ENTRIES) {
            if (def.type === 'number' || def.type === 'boolean' || def.type === 'path' || def.type === 'url')
                expect(def.validation, key).toBeInstanceOf(RegExp);
        }
    });

    test('COT_URL is the only required key', () => {
        const required = ENTRIES.filter(([, d]) => d.required === true).map(([k]) => k);
        expect(required).toEqual(['COT_URL']);
    });
});

describe('validation regexes', () => {
    const cases: [string[], string[], string[]][] = [
        [
            ['COT_URL'],
            [
                'udp+wo://239.2.3.1:6969',
                'tls://takserver:8089',
                'tcp://h:1',
                'file:///tmp/x',
                'udp://239.2.3.1:6969',
                'tcp+wo://10.0.0.1:8087',
                'udp+broadcast://255.255.255.255:6969',
                'http://example.com/cot',
                'https://example.com/cot',
                'log://stdout',
            ],
            [
                'http://exa mple.com',
                'tcp://h:1 ',
                'ftp://x',
                'takserver:8089',
                'takserver',
                'tls://',
                '',
            ],
        ],
        [
            ['COCKPIT_URL'],
            ['http://pi.local:9090', 'https://10.0.0.5:9090/lincot'],
            ['', 'ftp://pi.local', 'tcp://pi.local:9090', 'pi.local:9090', 'https://pi local', 'https://'],
        ],
        [
            ['STATIC_LAT', 'STATIC_LON', 'STATIC_HAE'],
            ['-12.5', '45', '0', '-0.000001', '123.456'],
            ['1e5', '12.', '.5', 'abc', '+12', '1,5', '', ' 12', '--1'],
        ],
        [
            ['POLL_INTERVAL', 'COT_STALE', 'TAK_PROTO'],
            ['0', '1', '61', '86400'],
            ['-1', '1.5', '1e3', 'abc', '', ' 1', '0x10'],
        ],
        [
            ['COT_TYPE'],
            ['a-f-G-E-S', 'a-f-G_U.C', 'b-m-p-s-p-loc', ''],
            ['a f G', 'a-f-G;rm', 'a/f', 'a-f-G\n'],
        ],
        [
            ['DEBUG', 'PYTAK_TLS_DONT_VERIFY', 'PYTAK_TLS_DONT_CHECK_HOSTNAME'],
            ['true', 'false', 'TRUE', 'False', 'yes', 'No', 'YES', '1', '0'],
            ['', 'y', 'n', 'on', 'off', '2', 'truee', ' true'],
        ],
        [
            ['PREF_PACKAGE', 'PYTAK_TLS_CLIENT_CERT', 'PYTAK_TLS_CLIENT_KEY', 'PYTAK_TLS_CLIENT_CAFILE'],
            ['', '/etc/lincot/pref.zip', '/etc/ssl/certs/client-cert.pem', '/opt/tak/my_ca.p12'],
            ['foo/bar', 'pref.zip', './pref.zip', '/etc/my certs/a.pem', '/etc/a.pem ', '~/a.pem'],
        ],
    ];

    for (const [keys, accept, reject] of cases) {
        for (const key of keys) {
            describe(key, () => {
                test.each(accept)(`accepts %j`, value => {
                    expect(regexFor(key).test(value)).toBe(true);
                });
                test.each(reject)(`rejects %j`, value => {
                    expect(regexFor(key).test(value)).toBe(false);
                });
            });
        }
    }

    test('COCKPIT_URL is optional, so an empty value is allowed although the regex rejects it', () => {
        const def = CONF_PARAMS.COCKPIT_URL;
        expect(def?.required).toBe(false);
        expect(def?.defaultValue).toBe('');
        expect(def?.validation?.test('')).toBe(false);
    });

    test('POLL_INTERVAL range is enforced separately from its digits-only regex', () => {
        const def = CONF_PARAMS.POLL_INTERVAL;
        expect(def?.range).toEqual([1, 86400]);
        expect(def?.validation?.test('0')).toBe(true);
    });
});

describe('/etc/default/lincot round trip', () => {
    const SAMPLE = [
        '# Configuration for LINCOT',
        '# See https://github.com/snstac/lincot',
        '',
        'COT_URL=tls://takserver:8089',
        'export CALLSIGN=Rover-1',
        'POLL_INTERVAL=30',
        '# Fixed position',
        'STATIC_LAT=-12.5',
        'STATIC_LON=45',
        'REMARKS_EXTRA="Vehicle 7 - north gate"',
        'GPS_INFO_CMD="gpspipe --json -n 5"',
        'DEBUG=true',
        'PYTAK_TLS_CLIENT_CERT=/etc/lincot/client.pem',
        'SOME_UNKNOWN_SETTING=keep me',
        '#COT_STALE=120',
        '',
    ].join('\n');

    const knownKeys = new Set(Object.keys(CONF_PARAMS));

    test('parses known keys, stripping quotes and the export prefix', () => {
        const { lines, values } = parseEnvDefault(SAMPLE, knownKeys);

        expect(values).toEqual({
            COT_URL: 'tls://takserver:8089',
            CALLSIGN: 'Rover-1',
            POLL_INTERVAL: '30',
            STATIC_LAT: '-12.5',
            STATIC_LON: '45',
            REMARKS_EXTRA: 'Vehicle 7 - north gate',
            GPS_INFO_CMD: 'gpspipe --json -n 5',
            DEBUG: 'true',
            PYTAK_TLS_CLIENT_CERT: '/etc/lincot/client.pem',
        });
        expect(lines).toContainEqual({ kind: 'known', key: 'CALLSIGN', exportVar: true });
        expect(lines).toContainEqual({ kind: 'unknown', text: 'SOME_UNKNOWN_SETTING=keep me' });
        expect(lines).toContainEqual({ kind: 'raw', text: '#COT_STALE=120' });
    });

    test('parsed values all pass CONF_PARAMS validation', () => {
        const { values } = parseEnvDefault(SAMPLE, knownKeys);
        for (const [key, value] of Object.entries(values)) {
            const re = CONF_PARAMS[key]?.validation;
            if (re)
                expect(re.test(value), key).toBe(true);
        }
    });

    test('serializing the unmodified form reproduces the file byte for byte', () => {
        const { lines, values } = parseEnvDefault(SAMPLE, knownKeys);
        const form = mergeFormValues(defaultFormFromConf(CONF_PARAMS), values);

        const out = serializeEnvDefault(lines, form, CONF_PARAMS, '# Added by Cockpit LINCOT');

        expect(out).toBe(SAMPLE);
        expect(parseEnvDefault(out, knownKeys).values).toEqual(values);
    });

    test('single-quoted values keep their value through a round trip', () => {
        const input = "COT_URL=tls://takserver:8089\nREMARKS_EXTRA='Vehicle 7 - north gate'\n";
        const { lines, values } = parseEnvDefault(input, knownKeys);
        const form = mergeFormValues(defaultFormFromConf(CONF_PARAMS), values);

        const out = serializeEnvDefault(lines, form, CONF_PARAMS);

        expect(out).toContain('REMARKS_EXTRA="Vehicle 7 - north gate"');
        expect(parseEnvDefault(out, knownKeys).values).toEqual(values);
    });

    test('an empty file only gets the required COT_URL appended', () => {
        const { lines } = parseEnvDefault('', knownKeys);
        const out = serializeEnvDefault(lines, defaultFormFromConf(CONF_PARAMS), CONF_PARAMS, '# Added by Cockpit LINCOT');

        expect(out).toBe('\n# Added by Cockpit LINCOT\nCOT_URL=udp+wo://239.2.3.1:6969');
    });
});
