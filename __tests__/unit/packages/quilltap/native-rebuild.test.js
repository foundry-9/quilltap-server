/**
 * @jest-environment node
 *
 * Unit tests for `rebuildNativePackage` — the directory-addressed native
 * rebuild behind both the CLI's `ensureDatabaseNativeModule()` and jest's own
 * globalSetup ABI heal.
 *
 * The contract that matters, and the reason this helper exists at all: a
 * rebuild tool that exits 0 is NOT evidence the binding was rebuilt. The
 * previous implementation shelled to `npm rebuild <name>`, which at the repo
 * root reports "rebuilt dependencies successfully" while rebuilding a phantom
 * directory and leaving the stale binary in place — so a whole test run stayed
 * red behind a success message. The helper therefore re-reads the compiled-for
 * ABI out of the binary afterwards and believes only that.
 *
 * Pure filesystem — fake `.bin` scripts stand in for prebuild-install/node-gyp.
 * No network, no compiler, no real addon.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const QUILLTAP_PKG = path.join(__dirname, '..', '..', '..', '..', 'packages', 'quilltap');
const { findBinFor, rebuildNativePackage } = require(path.join(QUILLTAP_PKG, 'lib', 'native-modules'));

const RUNNING_ABI = process.versions.modules;

let tmpRoot;

/** A fake installed package at <tmp>/node_modules/<name>, with a .bin sibling. */
function makePackage(name) {
  const nodeModules = path.join(tmpRoot, 'node_modules');
  const pkgDir = path.join(nodeModules, name);
  fs.mkdirSync(path.join(pkgDir, 'build', 'Release'), { recursive: true });
  fs.mkdirSync(path.join(nodeModules, '.bin'), { recursive: true });
  return { pkgDir, binDir: path.join(nodeModules, '.bin') };
}

/** Write an addon whose embedded ABI symbol says `abi`. */
function writeBinding(bindingPath, abi) {
  fs.writeFileSync(bindingPath, `\0\0padding node_register_module_v${abi} padding\0\0`);
}

/** A shell script on PATH-less disk that runs `body` and exits accordingly. */
function writeFakeBin(binDir, name, body) {
  const p = path.join(binDir, name);
  fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(p, 0o755);
  return p;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qtap-native-rebuild-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('findBinFor', () => {
  it('finds a tool in the .bin beside the package (the hoisted case)', () => {
    const { pkgDir, binDir } = makePackage('some-addon');
    const tool = writeFakeBin(binDir, 'prebuild-install', 'exit 0');

    expect(findBinFor(pkgDir, 'prebuild-install')).toBe(tool);
  });

  it('prefers the package\'s own nested .bin over the hoisted one', () => {
    const { pkgDir, binDir } = makePackage('some-addon');
    writeFakeBin(binDir, 'prebuild-install', 'exit 0');
    const nested = path.join(pkgDir, 'node_modules', '.bin');
    fs.mkdirSync(nested, { recursive: true });
    const own = writeFakeBin(nested, 'prebuild-install', 'exit 0');

    expect(findBinFor(pkgDir, 'prebuild-install')).toBe(own);
  });

  it('returns null when the tool is not installed anywhere', () => {
    const { pkgDir } = makePackage('some-addon');
    expect(findBinFor(pkgDir, 'prebuild-install')).toBeNull();
  });
});

describe('rebuildNativePackage', () => {
  it('reports success only once the binding actually carries the running ABI', () => {
    const { pkgDir, binDir } = makePackage('some-addon');
    const binding = path.join(pkgDir, 'build', 'Release', 'better_sqlite3.node');
    writeBinding(binding, '999');
    // A tool that does the job: rewrites the addon for the running ABI.
    writeFakeBin(
      binDir,
      'prebuild-install',
      `printf 'node_register_module_v${RUNNING_ABI}' > "${binding}"`
    );

    const result = rebuildNativePackage(pkgDir, binding);

    expect(result.ok).toBe(true);
    expect(result.reason).toBe('prebuild-install');
  });

  it('refuses to believe a tool that exits 0 and changes nothing', () => {
    // This is the exact shape of the bug: `npm rebuild` at the root printed
    // "rebuilt dependencies successfully" and left the stale binary alone.
    const { pkgDir, binDir } = makePackage('some-addon');
    const binding = path.join(pkgDir, 'build', 'Release', 'better_sqlite3.node');
    writeBinding(binding, '999');
    writeFakeBin(binDir, 'prebuild-install', 'echo "rebuilt dependencies successfully"; exit 0');

    const result = rebuildNativePackage(pkgDir, binding);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/exited 0 but the binding is still 999/);
    expect(result.reason).toContain(`wanted ${RUNNING_ABI}`);
  });

  it('falls through to node-gyp when prebuild-install fails, and succeeds there', () => {
    const { pkgDir, binDir } = makePackage('some-addon');
    const binding = path.join(pkgDir, 'build', 'Release', 'better_sqlite3.node');
    writeBinding(binding, '999');
    writeFakeBin(binDir, 'prebuild-install', 'echo "no prebuilt binary" >&2; exit 1');
    writeFakeBin(
      binDir,
      'node-gyp',
      `printf 'node_register_module_v${RUNNING_ABI}' > "${binding}"`
    );

    const result = rebuildNativePackage(pkgDir, binding);

    expect(result.ok).toBe(true);
    expect(result.reason).toBe('node-gyp rebuild');
  });

  it('names every attempt when they all fail', () => {
    const { pkgDir, binDir } = makePackage('some-addon');
    const binding = path.join(pkgDir, 'build', 'Release', 'better_sqlite3.node');
    writeBinding(binding, '999');
    writeFakeBin(binDir, 'prebuild-install', 'exit 1');
    writeFakeBin(binDir, 'node-gyp', 'exit 1');

    const result = rebuildNativePackage(pkgDir, binding);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('prebuild-install');
    expect(result.reason).toContain('node-gyp rebuild');
  });

  it('says so plainly when neither build tool is installed', () => {
    const { pkgDir } = makePackage('some-addon');
    const binding = path.join(pkgDir, 'build', 'Release', 'better_sqlite3.node');
    writeBinding(binding, '999');

    const result = rebuildNativePackage(pkgDir, binding);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('neither prebuild-install nor node-gyp is installed');
  });

  it('does not throw for a package directory that is not there', () => {
    const missing = path.join(tmpRoot, 'node_modules', 'nope');
    const result = rebuildNativePackage(missing, path.join(missing, 'build', 'Release', 'x.node'));

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no package at/);
  });
});
