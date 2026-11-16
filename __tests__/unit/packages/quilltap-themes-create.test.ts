/**
 * @jest-environment node
 *
 * `quilltap themes create <name>` writes the engine's blank bundle to
 * ./<id>/: a version 2 bundle the app's own engine accepts with no errors and
 * no warnings, whose JSON names the published schemas, whose hooksVersion is
 * the current hook catalogue version, and whose files are exactly those a
 * blank draft in the Atelier gets (`blankThemeBundle`). It refuses a
 * directory that exists.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

jest.mock('@/lib/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { logger: { ...log, child: () => log } };
});

import { validateThemeDirectory } from '@/lib/themes/bundle-archive';
import { blankThemeBundle, themeIdFromName } from '@/lib/themes/blank-bundle';
import { HOOK_CATALOGUE_VERSION } from '@/lib/themes/hooks';
import { THEME_MANIFEST_SCHEMA_URL, THEME_TOKENS_SCHEMA_URL } from '@/lib/themes/schemas';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const CLI = path.join(REPO_ROOT, 'packages/quilltap/bin/quilltap.js');

let tempDir: string;

function quilltap(...args: string[]) {
  return spawnSync(process.execPath, [CLI, 'themes', ...args], { cwd: tempDir, encoding: 'utf-8', input: '' });
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qtap-themes-create-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('quilltap themes create', () => {
  it('writes the blank bundle, which the theme engine accepts cleanly', async () => {
    const run = quilltap('create', 'Brass', 'Parlour');
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('quilltap themes validate ./brass-parlour');
    expect(run.stdout).toContain('Open a theme file');

    const dir = path.join(tempDir, 'brass-parlour');
    const blank = blankThemeBundle({ id: 'brass-parlour', name: 'Brass Parlour' });
    expect(fs.readdirSync(dir).sort()).toEqual(blank.map((f) => f.path).sort());
    for (const file of blank) {
      expect(fs.readFileSync(path.join(dir, file.path), 'utf-8')).toBe(file.text);
    }

    const result = await validateThemeDirectory(dir);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.manifest).toMatchObject({ id: 'brass-parlour', name: 'Brass Parlour', formatVersion: 2 });

    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'theme.json'), 'utf-8'));
    const tokens = JSON.parse(fs.readFileSync(path.join(dir, 'tokens.json'), 'utf-8'));
    expect(manifest.$schema).toBe(THEME_MANIFEST_SCHEMA_URL);
    expect(tokens.$schema).toBe(THEME_TOKENS_SCHEMA_URL);
    expect(manifest.hooksVersion).toBe(HOOK_CATALOGUE_VERSION);
  });

  it('derives the id as the Atelier does', () => {
    expect(quilltap('create', '  Café  Noir! ').status).toBe(0);
    expect(fs.existsSync(path.join(tempDir, themeIdFromName('Café Noir')))).toBe(true);
    expect(quilltap('create', '1920s').status).toBe(0);
    expect(fs.existsSync(path.join(tempDir, 'theme-1920s'))).toBe(true);
  });

  it('passes `quilltap themes validate`', () => {
    expect(quilltap('create', 'ocean-breeze').status).toBe(0);
    const out = quilltap('validate', './ocean-breeze');
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('Valid');
    expect(out.stdout).not.toContain('Warning');
  });

  it('refuses a directory that exists and leaves it alone', () => {
    fs.mkdirSync(path.join(tempDir, 'sunset'));
    fs.writeFileSync(path.join(tempDir, 'sunset', 'keep.txt'), 'mine');
    const run = quilltap('create', 'Sunset');
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('already exists');
    expect(fs.readdirSync(path.join(tempDir, 'sunset'))).toEqual(['keep.txt']);
  });

  it('requires a name', () => {
    const run = quilltap('create');
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('requires a theme name');
  });
});
