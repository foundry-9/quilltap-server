/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  isOptimizeDue,
  localDateStamp,
  optimizeDatabase,
  readOptimizeState,
  writeOptimizeState,
} from '../daily-db-optimize';

jest.mock('@/lib/logger', () => {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { logger: { ...log, child: () => log } };
});
jest.mock('@/lib/startup/progress', () => ({
  startupProgress: { setCurrent: jest.fn(), setSubProgress: jest.fn(), publish: jest.fn() },
}));

describe('daily-db-optimize', () => {
  let tmpDir: string;
  let statePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-optimize-'));
    statePath = path.join(tmpDir, 'db-optimize-state.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stamps the local calendar date', () => {
    expect(localDateStamp(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localDateStamp(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31');
  });

  it('treats a missing or corrupt state file as never optimized', () => {
    expect(readOptimizeState(statePath)).toEqual({});
    fs.writeFileSync(statePath, '{not json');
    expect(readOptimizeState(statePath)).toEqual({});
    fs.writeFileSync(statePath, '[1,2]');
    expect(readOptimizeState(statePath)).toEqual({});
  });

  it('round-trips state and ignores unknown keys', () => {
    writeOptimizeState({ main: '2026-10-07', 'llm-logs': '2026-10-06' }, statePath);
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    raw.bogus = 'x';
    fs.writeFileSync(statePath, JSON.stringify(raw));
    expect(readOptimizeState(statePath)).toEqual({ main: '2026-10-07', 'llm-logs': '2026-10-06' });
  });

  it('is due only when not already optimized today', () => {
    const state = { main: '2026-10-07', 'llm-logs': '2026-10-06' };
    expect(isOptimizeDue(state, 'main', '2026-10-07')).toBe(false);
    expect(isOptimizeDue(state, 'llm-logs', '2026-10-07')).toBe(true);
    expect(isOptimizeDue(state, 'mount-points', '2026-10-07')).toBe(true);
  });

  it('runs VACUUM, ANALYZE, PRAGMA optimize in order', () => {
    const calls: string[] = [];
    const db = {
      exec: jest.fn((sql: string) => { calls.push(sql); }),
      pragma: jest.fn((p: string) => { calls.push(`PRAGMA ${p}`); }),
    };
    const result = optimizeDatabase(db as never, 'main');
    expect(result.ok).toBe(true);
    expect(calls).toEqual(['VACUUM', 'ANALYZE', 'PRAGMA optimize']);
    expect(result.steps.map((s) => s.name)).toEqual(['VACUUM', 'ANALYZE', 'PRAGMA optimize']);
  });

  it('stops at the first failing step', () => {
    const db = {
      exec: jest.fn((sql: string) => {
        if (sql === 'VACUUM') throw new Error('database or disk is full');
      }),
      pragma: jest.fn(),
    };
    const result = optimizeDatabase(db as never, 'main');
    expect(result.ok).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ name: 'VACUUM', ok: false, error: 'database or disk is full' });
    expect(db.pragma).not.toHaveBeenCalled();
  });
});
