/**
 * @jest-environment node
 *
 * Unit tests for the CLI's SQLCipher driver load check
 * (`packages/quilltap/lib/native-modules.js`).
 *
 * The driver is a Node-API addon whose per-platform prebuilds ship inside the
 * npm package, so the CLI no longer rebuilds it. What it does instead:
 *   - `betterSqlite3BindingPath()` names the prebuild the loader would pick;
 *   - `classifyDriverLoadFailure()` turns a failed load into a reason
 *     (unsupported platform, glibc too old, anything else);
 *   - `ensureDatabaseNativeModule()` is silent and returns true when healthy.
 *
 * Loads the real driver on this machine — no mocks.
 */

const fs = require('fs');
const path = require('path');

const QUILLTAP_PKG = path.join(__dirname, '..', '..', '..', '..', 'packages', 'quilltap');
const {
  betterSqlite3BindingPath,
  classifyDriverLoadFailure,
  ensureDatabaseNativeModule,
} = require(path.join(QUILLTAP_PKG, 'lib', 'native-modules'));

describe('betterSqlite3BindingPath', () => {
  it('returns an existing prebuild for this platform', () => {
    const bindingPath = betterSqlite3BindingPath();
    expect(bindingPath).not.toBeNull();
    expect(fs.existsSync(bindingPath)).toBe(true);
    expect(bindingPath.endsWith(`${process.platform}-${process.arch}.node`)).toBe(true);
  });
});

describe('classifyDriverLoadFailure', () => {
  const base = { platform: 'linux', arch: 'x64', prebuildPath: '/x/prebuilds/linux-x64.node' };

  it('reports an unsupported platform when there is no prebuild', () => {
    const result = classifyDriverLoadFailure({ ...base, platform: 'freebsd', prebuildPath: null, error: null });
    expect(result.kind).toBe('unsupported-platform');
    expect(result.message).toContain('freebsd-x64');
    expect(result.hint).toContain('linux-arm64');
  });

  it('reports glibc too old from the loader error', () => {
    const error = new Error(
      "/lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.35' not found (required by /x/prebuilds/linux-x64.node)",
    );
    const result = classifyDriverLoadFailure({ ...base, error });
    expect(result.kind).toBe('glibc-too-old');
    expect(result.message).toContain('2.35');
  });

  it('falls back to load-failed with the first line of the error', () => {
    const error = new Error('something odd happened\nstack line');
    const result = classifyDriverLoadFailure({ ...base, error });
    expect(result.kind).toBe('load-failed');
    expect(result.message).toContain('something odd happened');
    expect(result.message).not.toContain('stack line');
  });
});

describe('ensureDatabaseNativeModule', () => {
  it('returns true and prints nothing when the driver loads', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(ensureDatabaseNativeModule()).toBe(true);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});
