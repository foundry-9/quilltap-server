/**
 * @jest-environment node
 *
 * Calliope Live, Spec G Stage 1: a draft's issues name their file and line,
 * the custom stylesheet is attached, detached and saved, and a `.qtap-theme`
 * archive opens as a new draft — over an in-memory Quilltap General, with the
 * real registry, loader and archive checks.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const mockThemesDir = path.join(os.tmpdir(), `qtap-test-draft-styles-themes-${process.pid}-${Date.now()}`);

jest.mock('@/lib/paths', () => ({
  ...jest.requireActual('@/lib/paths'),
  getThemesDir: () => mockThemesDir,
}));
jest.mock('@/lib/themes/drafts/store', () => jest.requireActual('../../../../helpers/theme-drafts-fake-store').storeModule);
jest.mock('@/lib/doc-edit/uri-producers', () => ({
  docStoreUriFor: async ({ relativePath }: { relativePath: string }) => `qtap://Quilltap General/${relativePath}`,
}));
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }));

import * as fake from '../../../../helpers/theme-drafts-fake-store';
import { themeRegistry } from '@/lib/themes/theme-registry';
import { earlierThemeMessage } from '@/lib/themes/refused';
import { MAX_BUNDLE_SIZE, MAX_FILE_COUNT, packThemeDirectory } from '@/lib/themes/bundle-archive';
import { createHash } from 'node:crypto';
import {
  clearDraftStylesFile,
  DraftImportRefusedError,
  DraftManifestRevisionConflictError,
  DraftOperationRefusedError,
  DraftRevisionConflictError,
  importDraft,
  readDraft,
  setDraftStylesFile,
  writeDraftStyles,
  type DraftDetail,
} from '@/lib/themes/drafts';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const FIXTURE = path.join(REPO_ROOT, '__tests__/fixtures/themes/v2-sample');
const V1_FIXTURE = path.join(REPO_ROOT, '__tests__/fixtures/themes/v1-sample');
const BUNDLED = path.join(REPO_ROOT, 'themes/bundled');

let work: string;

beforeAll(async () => {
  await fs.mkdir(mockThemesDir, { recursive: true });
  await themeRegistry.initialize();
});

afterAll(async () => {
  await fs.rm(mockThemesDir, { recursive: true, force: true });
});

beforeEach(async () => {
  fake.reset();
  work = await fs.mkdtemp(path.join(os.tmpdir(), 'qtap-test-draft-import-'));
});

afterEach(async () => {
  await fs.rm(work, { recursive: true, force: true });
});

const manifestOf = (id: string) => JSON.parse(fake.get(id, 'theme.json')!.toString());
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Seed the version 2 fixture as draft `id`, with `patch` merged into its manifest (undefined deletes a key). */
async function seed(id: string, patch: Record<string, unknown> = {}): Promise<DraftDetail> {
  await fake.seedFromDir(id, FIXTURE);
  const manifest = { ...manifestOf(id), id, version: '0.3.0', ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete manifest[k];
  fake.put(`Themes/${id}/theme.json`, JSON.stringify(manifest, null, 2));
  return readDraft(id);
}

// ============================================================================
// Structured issues
// ============================================================================

describe('a draft\'s issues', () => {
  it('give a parse error in the stylesheet its file and line', async () => {
    await seed('broken-css');
    fake.put('Themes/broken-css/styles.css', '.a { color: red; }\n.b {\n');
    const draft = await readDraft('broken-css');
    const issue = draft.issues.find((i) => i.file === 'styles.css');
    expect(issue).toMatchObject({ severity: 'error', file: 'styles.css', line: 2 });
    expect(issue?.message).toMatch(/^styles\.css: custom CSS does not parse \(line 2\)/);
  });

  it('give a refused at-rule its line', async () => {
    await seed('at-rule');
    fake.put('Themes/at-rule/styles.css', '.qt-card { color: red; }\n\n@import url("x.css");\n');
    const draft = await readDraft('at-rule');
    expect(draft.issues).toContainEqual({ severity: 'error', message: 'styles.css: @import is not allowed (line 3)', file: 'styles.css', line: 3 });
  });

  it('give a hook finding its line, as a warning', async () => {
    await seed('off-hook');
    fake.put('Themes/off-hook/styles.css', '.qt-card { color: red; }\n.made-up-class { color: blue; }\n');
    const draft = await readDraft('off-hook');
    const finding = draft.issues.find((i) => i.message.includes('.made-up-class'));
    expect(finding).toMatchObject({ severity: 'warning', file: 'styles.css', line: 2 });
  });

  it('name the file of a tokens error, with no line', async () => {
    await seed('bad-tokens');
    fake.put('Themes/bad-tokens/tokens.json', '{ not json');
    const draft = await readDraft('bad-tokens');
    const issue = draft.issues.find((i) => i.file === 'tokens.json');
    expect(issue?.severity).toBe('error');
    expect(issue?.line).toBeUndefined();
  });
});

// ============================================================================
// The stylesheet
// ============================================================================

describe('the stylesheet', () => {
  it('is in the detail: path, text and revision', async () => {
    const draft = await seed('with-css');
    const text = fake.get('with-css', 'styles.css')!.toString();
    expect(draft.styles).toEqual({ path: 'styles.css', text, revision: sha(text) });
  });

  it('is null when the manifest names none', async () => {
    const draft = await seed('no-css', { stylesPath: undefined });
    expect(draft.styles).toBeNull();
  });

  it('is set: a new empty styles.css, named in the manifest', async () => {
    const before = await seed('set-css', { stylesPath: undefined });
    fake.files.delete('Themes/set-css/styles.css');
    const result = await setDraftStylesFile('set-css', { revision: before.manifestRevision });
    expect(result).toMatchObject({ path: 'styles.css', created: true });
    expect(manifestOf('set-css').stylesPath).toBe('styles.css');
    expect(fake.get('set-css', 'styles.css')?.length).toBe(0);
    expect(result.draft.styles).toEqual({ path: 'styles.css', text: '', revision: sha('') });
    expect(result.draft.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('is set again from a styles.css left behind, keeping its text', async () => {
    const before = await seed('reattach', { stylesPath: undefined });
    const text = fake.get('reattach', 'styles.css')!.toString();
    const result = await setDraftStylesFile('reattach', { revision: before.manifestRevision });
    expect(result.created).toBe(false);
    expect(result.draft.styles?.text).toBe(text);
  });

  it('refuses a stale manifest revision', async () => {
    await seed('stale-set', { stylesPath: undefined });
    await expect(setDraftStylesFile('stale-set', { revision: 'not-it' })).rejects.toBeInstanceOf(DraftManifestRevisionConflictError);
    expect(manifestOf('stale-set').stylesPath).toBeUndefined();
  });

  it('is cleared, keeping the file unless asked', async () => {
    const before = await seed('clear-keep');
    const kept = await clearDraftStylesFile('clear-keep', { revision: before.manifestRevision });
    expect(manifestOf('clear-keep').stylesPath).toBeUndefined();
    expect(kept.deleted).toEqual([]);
    expect(fake.get('clear-keep', 'styles.css')).toBeDefined();
    expect(kept.draft.styles).toBeNull();
    // The manifest goes first, so the draft is still valid with the file left over.
    expect(kept.draft.issues.filter((i) => i.severity === 'error')).toEqual([]);

    const again = await seed('clear-delete');
    const deleted = await clearDraftStylesFile('clear-delete', { revision: again.manifestRevision, deleteFile: true });
    expect(deleted.deleted).toEqual(['styles.css']);
    expect(fake.get('clear-delete', 'styles.css')).toBeUndefined();
  });

  it('refuses to clear a stylesheet the draft does not have', async () => {
    const before = await seed('nothing-to-clear', { stylesPath: undefined });
    await expect(clearDraftStylesFile('nothing-to-clear', { revision: before.manifestRevision })).rejects.toBeInstanceOf(DraftOperationRefusedError);
  });

  it('saves valid CSS and hands back the scoped CSS', async () => {
    const before = await seed('save-ok');
    const css = '.qt-card {\n  border-radius: 2px;\n}\n';
    const draft = await writeDraftStyles('save-ok', { revision: before.styles!.revision, css });
    expect(fake.get('save-ok', 'styles.css')!.toString()).toBe(css);
    expect(draft.styles).toEqual({ path: 'styles.css', text: css, revision: sha(css) });
    expect(draft.compiled.custom).toContain('border-radius: 2px');
    expect(draft.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('saves invalid CSS as written, with its errors on their lines', async () => {
    const before = await seed('save-bad');
    const css = '.qt-card { color: red; }\n@font-face { font-family: X; }\n';
    const draft = await writeDraftStyles('save-bad', { revision: before.styles!.revision, css });
    expect(fake.get('save-bad', 'styles.css')!.toString()).toBe(css);
    expect(draft.compiled.custom).toBe('');
    expect(draft.issues).toContainEqual(expect.objectContaining({ severity: 'error', file: 'styles.css', line: 2 }));
  });

  it('keeps bytes exactly: CRLF, tabs and no final newline', async () => {
    const before = await seed('save-bytes');
    const css = '.qt-card {\r\n\tcolor: red;\r\n}';
    const draft = await writeDraftStyles('save-bytes', { revision: before.styles!.revision, css });
    expect(fake.get('save-bytes', 'styles.css')!.toString()).toBe(css);
    expect(draft.styles?.text).toBe(css);
  });

  it('refuses a stale styles revision and writes nothing', async () => {
    const before = await seed('save-stale');
    const original = fake.get('save-stale', 'styles.css')!.toString();
    fake.put('Themes/save-stale/styles.css', `${original}\n/* edited elsewhere */\n`);
    const error = await writeDraftStyles('save-stale', { revision: before.styles!.revision, css: '.x {}' }).catch((e) => e);
    expect(error).toBeInstanceOf(DraftRevisionConflictError);
    expect((error as DraftRevisionConflictError).currentRevision).toBe(sha(`${original}\n/* edited elsewhere */\n`));
    expect(fake.get('save-stale', 'styles.css')!.toString()).toBe(`${original}\n/* edited elsewhere */\n`);
  });

  it('creates a named stylesheet that is missing, from the revision `missing`', async () => {
    await seed('named-missing');
    fake.files.delete('Themes/named-missing/styles.css');
    const draft = await readDraft('named-missing');
    expect(draft.styles).toEqual({ path: 'styles.css', text: '', revision: 'missing' });
    const saved = await writeDraftStyles('named-missing', { revision: 'missing', css: '.qt-card { color: red; }\n' });
    expect(saved.styles?.text).toBe('.qt-card { color: red; }\n');
  });

  it('refuses a save when the draft names no stylesheet', async () => {
    await seed('save-none', { stylesPath: undefined });
    await expect(writeDraftStyles('save-none', { revision: 'missing', css: '' })).rejects.toBeInstanceOf(DraftOperationRefusedError);
  });
});

// ============================================================================
// Import
// ============================================================================

/** Every file under a directory, path → bytes. */
async function filesOf(dir: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  const walk = async (rel: string) => {
    for (const entry of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(child);
      else out.set(child, await fs.readFile(path.join(dir, child)));
    }
  };
  await walk('');
  return out;
}

const upload = async (archive: string) => ({ fileName: path.basename(archive), bytes: await fs.readFile(archive) });

/** A zip with stored (uncompressed) entries, names exactly as given. */
function storedZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

const draftFolders = () => new Set([...fake.files.keys()].map((k) => k.split('/')[1]));

describe('import', () => {
  const bundled = ['art-deco', 'earl-grey', 'great-estate', 'madmans-box', 'old-school', 'rains'];

  it.each(bundled)('opens the bundled theme %s as a draft with every file as it was', async (themeId) => {
    const source = path.join(BUNDLED, themeId);
    const archive = path.join(work, `${themeId}.qtap-theme`);
    await packThemeDirectory(source, archive);
    const result = await importDraft(await upload(archive));

    // The id is taken by the installed theme, so the draft has a numbered one.
    expect(result.bundleId).toBe(themeId);
    expect(result.idChanged).toBe(true);
    expect(result.draft.id).toBe(`${themeId}-2`);
    expect(result.draft.issues.filter((i) => i.severity === 'error')).toEqual([]);

    const expected = await filesOf(source);
    const draftId = result.draft.id;
    const got = new Set([...fake.files.keys()].filter((k) => k.startsWith(`Themes/${draftId}/`)).map((k) => k.slice(`Themes/${draftId}/`.length)));
    expect([...got].sort()).toEqual([...expected.keys()].sort());
    for (const [rel, bytes] of expected) {
      if (rel === 'theme.json') continue;
      expect(fake.get(draftId, rel)?.equals(bytes)).toBe(true);
    }
    // The manifest is the bundle's, under the draft's id; name and version kept.
    const sourceManifest = JSON.parse(expected.get('theme.json')!.toString());
    expect(manifestOf(draftId)).toEqual({ ...sourceManifest, id: draftId });
  });

  it('keeps the bundle\'s id when it is free', async () => {
    const archive = path.join(work, 'v2-sample.qtap-theme');
    await packThemeDirectory(FIXTURE, archive);
    const result = await importDraft(await upload(archive));
    expect(result).toMatchObject({ bundleId: 'v2-sample', idChanged: false });
    expect(result.draft.id).toBe('v2-sample');
    expect(result.draft.manifest).toMatchObject({ name: 'Version 2 Sample', version: '1.0.0' });
  });

  it('numbers the id when a draft already holds it', async () => {
    const archive = path.join(work, 'v2-sample.qtap-theme');
    await packThemeDirectory(FIXTURE, archive);
    await importDraft(await upload(archive));
    const second = await importDraft(await upload(archive));
    expect(second).toMatchObject({ bundleId: 'v2-sample', idChanged: true });
    expect(second.draft.id).toBe('v2-sample-2');
  });

  it('refuses a version 1 bundle with the earlier-theme message, writing nothing', async () => {
    const archive = path.join(work, 'v1-sample.qtap-theme');
    execFileSync('zip', ['-r', '-q', archive, '.'], { cwd: V1_FIXTURE, stdio: 'pipe' });
    const error = await importDraft(await upload(archive)).catch((e) => e);
    expect(error).toBeInstanceOf(DraftImportRefusedError);
    expect(error).toMatchObject({ reason: 'refused', message: earlierThemeMessage('Version 1 Sample') });
    expect(fake.files.size).toBe(0);
  });

  it('refuses an archive holding a symbolic link, writing nothing', async () => {
    const dir = path.join(work, 'linked');
    await fs.cp(FIXTURE, dir, { recursive: true });
    await fs.symlink('/etc/hosts', path.join(dir, 'hosts.txt'));
    const archive = path.join(work, 'linked.qtap-theme');
    execFileSync('zip', ['-r', '-q', '--symlinks', archive, '.'], { cwd: dir, stdio: 'pipe' });
    const error = await importDraft(await upload(archive)).catch((e) => e);
    expect(error).toBeInstanceOf(DraftImportRefusedError);
    expect((error as DraftImportRefusedError).errors).toContain('Symbolic links are not allowed in theme bundles: hosts.txt');
    expect(fake.files.size).toBe(0);
  });

  it('refuses an archive with a path that climbs out, writing nothing', async () => {
    const theme = await fs.readFile(path.join(FIXTURE, 'theme.json'));
    const tokens = await fs.readFile(path.join(FIXTURE, 'tokens.json'));
    const bytes = storedZip([
      { name: 'theme.json', data: theme },
      { name: 'tokens.json', data: tokens },
      { name: '../../escaped.css', data: Buffer.from('.a{}') },
    ]);
    const error = await importDraft({ fileName: 'climb.qtap-theme', bytes }).catch((e) => e);
    expect(error).toBeInstanceOf(DraftImportRefusedError);
    expect((error as DraftImportRefusedError).reason).toBe('invalid');
    expect(fake.files.size).toBe(0);
    await expect(fs.access(path.join(os.tmpdir(), 'escaped.css'))).rejects.toThrow();
  });

  it('refuses an archive larger than a bundle may be, before reading it', async () => {
    const error = await importDraft({ fileName: 'huge.qtap-theme', bytes: Buffer.alloc(MAX_BUNDLE_SIZE + 1) }).catch((e) => e);
    expect(error).toBeInstanceOf(DraftImportRefusedError);
    expect((error as DraftImportRefusedError).reason).toBe('limit');
    expect(fake.files.size).toBe(0);
  });

  it('refuses an archive with more files than a bundle may hold', async () => {
    const dir = path.join(work, 'crowded');
    await fs.cp(FIXTURE, dir, { recursive: true });
    await fs.mkdir(path.join(dir, 'notes'));
    for (let i = 0; i < MAX_FILE_COUNT; i++) await fs.writeFile(path.join(dir, 'notes', `n${i}.txt`), 'x');
    const archive = path.join(work, 'crowded.qtap-theme');
    execFileSync('zip', ['-r', '-q', archive, '.'], { cwd: dir, stdio: 'pipe' });
    const error = await importDraft(await upload(archive)).catch((e) => e);
    expect(error).toBeInstanceOf(DraftImportRefusedError);
    expect((error as DraftImportRefusedError).reason).toBe('limit');
    expect(fake.files.size).toBe(0);
  });

  it('refuses an archive that would not install (a broken stylesheet)', async () => {
    const dir = path.join(work, 'bad-css');
    await fs.cp(FIXTURE, dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'styles.css'), '@import url("x.css");\n');
    const archive = path.join(work, 'bad-css.qtap-theme');
    execFileSync('zip', ['-r', '-q', archive, '.'], { cwd: dir, stdio: 'pipe' });
    const error = await importDraft(await upload(archive)).catch((e) => e);
    expect(error).toBeInstanceOf(DraftImportRefusedError);
    expect((error as DraftImportRefusedError).errors).toContain('styles.css: @import is not allowed (line 1)');
    expect(draftFolders().size).toBe(0);
  });

  it('removes its temporary directory whatever happens', async () => {
    const before = new Set((await fs.readdir(os.tmpdir())).filter((n) => n.startsWith('qtap-theme-import-')));
    const archive = path.join(work, 'v2-sample.qtap-theme');
    await packThemeDirectory(FIXTURE, archive);
    await importDraft(await upload(archive));
    await importDraft({ fileName: 'junk.qtap-theme', bytes: Buffer.from('not a zip') }).catch(() => undefined);
    const after = (await fs.readdir(os.tmpdir())).filter((n) => n.startsWith('qtap-theme-import-') && !before.has(n));
    expect(after).toEqual([]);
  });
});
