/**
 * @jest-environment node
 *
 * create-quilltap-theme writes a version 2 bundle that the app's own engine
 * (the one `quilltap themes validate` carries) accepts with no errors and no
 * warnings, whose JSON names the published schemas, and whose hooksVersion is
 * the app's current hook catalogue version. `--plugin` is refused.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

jest.mock('@/lib/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { logger: { ...log, child: () => log } };
});

import { validateThemeDirectory } from '@/lib/themes/bundle-archive';
import { HOOK_CATALOGUE_VERSION } from '@/lib/themes/hooks';
import { THEME_MANIFEST_SCHEMA_URL, THEME_TOKENS_SCHEMA_URL } from '@/lib/themes/schemas';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const PACKAGE = path.join(REPO_ROOT, 'packages/create-quilltap-theme');
const SOURCE = path.join(PACKAGE, 'src/index.ts');
const TSX = path.join(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

let tempDir: string;

function scaffold(...args: string[]) {
  return spawnSync(process.execPath, [TSX, SOURCE, ...args], { cwd: tempDir, encoding: 'utf-8', input: '' });
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qtap-scaffold-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('create-quilltap-theme', () => {
  it('writes a version 2 bundle the theme engine accepts cleanly', async () => {
    const run = scaffold('sunset', '--yes');
    expect(run.status).toBe(0);

    const dir = path.join(tempDir, 'sunset');
    expect(fs.readdirSync(dir).sort()).toEqual(['README.md', 'styles.css', 'theme.json', 'tokens.json']);

    const result = await validateThemeDirectory(dir);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.manifest).toMatchObject({ id: 'sunset', formatVersion: 2, stylesPath: 'styles.css' });

    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'theme.json'), 'utf-8'));
    const tokens = JSON.parse(fs.readFileSync(path.join(dir, 'tokens.json'), 'utf-8'));
    expect(manifest.$schema).toBe(THEME_MANIFEST_SCHEMA_URL);
    expect(tokens.$schema).toBe(THEME_TOKENS_SCHEMA_URL);
    expect(manifest.hooksVersion).toBe(HOOK_CATALOGUE_VERSION);
  });

  it('names the current hook catalogue version', () => {
    const source = fs.readFileSync(SOURCE, 'utf-8');
    expect(source).toMatch(new RegExp(`export const HOOKS_VERSION = ${HOOK_CATALOGUE_VERSION};`));
  });

  it('refuses the retired --plugin format', () => {
    const run = scaffold('sunset', '--plugin');
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('no longer supported');
    expect(fs.existsSync(path.join(tempDir, 'sunset'))).toBe(false);
  });

  it('passes `quilltap themes validate`', () => {
    expect(scaffold('ocean-breeze', '--yes').status).toBe(0);
    const out = execFileSync(
      process.execPath,
      [path.join(REPO_ROOT, 'packages/quilltap/bin/quilltap.js'), 'themes', 'validate', path.join(tempDir, 'ocean-breeze')],
      { encoding: 'utf-8' }
    );
    expect(out).toContain('Valid');
    expect(out).not.toContain('Warning');
  });
});
