/**
 * Universal-flag parsing and server-port resolution for the HTTP diagnostic
 * tools (anchor-probe, recall-replay, memory-diff).
 *
 * @jest-environment node
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveServerPort } = require('../lock-helpers');
const tools = {
  'anchor-probe': require('../anchor-probe-command').parseFlags,
  'recall-replay': require('../recall-replay-command').parseFlags,
  'memory-diff': require('../memory-diff-command').parseFlags,
};

describe.each(Object.keys(tools))('%s flag parsing', (name) => {
  const parseFlags = tools[name];

  it.each([
    [['--instance', 'V4test', 'ID']],
    [['ID', '--instance', 'V4test']],
    [['-i', 'V4test', 'ID']],
    [['ID', '-i', 'V4test']],
  ])('accepts the instance flag around the positional id (%j)', (args) => {
    const { flags, positional } = parseFlags(args);
    expect(flags.instance).toBe('V4test');
    expect(positional).toEqual(['ID']);
  });

  it.each([
    [['--data-dir', '/x/y', 'ID']],
    [['ID', '-d', '/x/y']],
  ])('accepts the data-dir flag (%j)', (args) => {
    const { flags, positional } = parseFlags(args);
    expect(flags.dataDir).toBe('/x/y');
    expect(positional).toEqual(['ID']);
  });

  it('accepts --passphrase without treating its value as the id', () => {
    const { positional } = parseFlags(['--passphrase', 'hunter2', 'ID']);
    expect(positional).toEqual(['ID']);
    expect(parseFlags(['ID', '--passphrase', 'hunter2']).positional).toEqual(['ID']);
  });

  it('leaves the port undefined unless --port is given', () => {
    expect(parseFlags(['ID']).flags.port).toBeUndefined();
    expect(parseFlags(['ID', '--port', '3005']).flags.port).toBe(3005);
  });
});

describe('resolveServerPort', () => {
  let root;
  let lockPath;

  function writeLock(overrides = {}) {
    const now = new Date().toISOString();
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: process.pid,
      hostname: os.hostname(),
      startedAt: now,
      lastHeartbeat: now,
      environment: 'local',
      processTitle: 'node',
      processArgv0: process.argv[0],
      history: [],
      ...overrides,
    }));
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'qtap-port-test-'));
    fs.mkdirSync(path.join(root, 'data'));
    lockPath = path.join(root, 'data', 'quilltap.lock');
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('defaults to 3000 with no flags at all', () => {
    expect(resolveServerPort({})).toMatchObject({ port: 3000, source: 'default', note: null });
  });

  it('lets an explicit --port win over a live lock', () => {
    writeLock({ port: 3005 });
    expect(resolveServerPort({ port: 4000, dataDir: root })).toMatchObject({ port: 4000, source: 'flag' });
  });

  it('uses the port from a live lock and says so', () => {
    writeLock({ port: 3005 });
    const r = resolveServerPort({ dataDir: root });
    expect(r).toMatchObject({ port: 3005, source: 'lock' });
    expect(r.note).toContain('3005');
  });

  it('falls back to 3000 when the live lock records no port', () => {
    writeLock();
    const r = resolveServerPort({ dataDir: root });
    expect(r).toMatchObject({ port: 3000, source: 'default', note: null });
    expect(r.hint).toContain('records no port');
  });

  it('ignores the port of a stale lock', () => {
    writeLock({ pid: 2 ** 22 + 12345, port: 3005 });
    const r = resolveServerPort({ dataDir: root });
    expect(r.port).toBe(3000);
    expect(r.hint).toContain('stale');
  });

  it('falls back to 3000 when there is no lock', () => {
    const r = resolveServerPort({ dataDir: root });
    expect(r.port).toBe(3000);
    expect(r.hint).toContain('no instance lock');
  });

  it('rejects --instance together with --data-dir', () => {
    expect(() => resolveServerPort({ instance: 'x', dataDir: root })).toThrow(/not both/);
  });
});
