/**
 * @jest-environment node
 *
 * Theme drafts (Calliope Live, Spec D §1.4): create, read, save, delete and
 * install, over an in-memory Quilltap General (the store module is the
 * drafts' only door to it). The registry, the loader, the compiler, the
 * image conversion and the install are real; installs land in a temporary
 * themes directory.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const mockThemesDir = path.join(os.tmpdir(), `qtap-test-drafts-themes-${process.pid}-${Date.now()}`);

jest.mock('@/lib/paths', () => ({
  ...jest.requireActual('@/lib/paths'),
  getThemesDir: () => mockThemesDir,
}));
jest.mock('@/lib/themes/drafts/store', () => jest.requireActual('../../../../helpers/theme-drafts-fake-store').storeModule);
jest.mock('@/lib/doc-edit/uri-producers', () => ({
  docStoreUriFor: async ({ relativePath }: { relativePath: string }) => `qtap://Quilltap General/${relativePath}`,
}));
jest.mock('@/lib/realtime/bus', () => ({ publishRealtime: jest.fn() }));
/** The bytes each served response carried, captured on their way to the route helper. */
const mockServedBytes: Uint8Array[] = [];
jest.mock('@/lib/api/serve-stored-bytes', () => {
  const actual = jest.requireActual('@/lib/api/serve-stored-bytes');
  return {
    ...actual,
    serveStoredBytes: (data: Uint8Array, options: unknown) => {
      mockServedBytes.push(data);
      return actual.serveStoredBytes(data, options);
    },
  };
});

import * as fake from '../../../../helpers/theme-drafts-fake-store';
import { themeRegistry } from '@/lib/themes/theme-registry';
import { publishRealtime } from '@/lib/realtime/bus';
import {
  bumpPatch,
  createDraft,
  deleteDraft,
  draftIdFromName,
  DraftNotInstallableError,
  DraftRevisionConflictError,
  installDraft,
  listDrafts,
  readDraft,
  writeDraftManifestFields,
  writeDraftTokens,
} from '@/lib/themes/drafts';
import { serveDraftThemeFile } from '@/lib/themes/drafts/serve';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const FIXTURE = path.join(REPO_ROOT, '__tests__/fixtures/themes/v2-sample');
const BUNDLED = ['art-deco', 'earl-grey', 'great-estate', 'madmans-box', 'old-school', 'rains'];

beforeAll(async () => {
  await fs.mkdir(mockThemesDir, { recursive: true });
  await themeRegistry.initialize();
});

afterAll(async () => {
  await fs.rm(mockThemesDir, { recursive: true, force: true });
});

beforeEach(() => fake.reset());

const errorsOf = (d: { issues: { severity: string; message: string }[] }) =>
  d.issues.filter((i) => i.severity === 'error').map((i) => i.message);

describe('ids', () => {
  it('slugs a name into a theme id that starts with a letter', () => {
    expect(draftIdFromName('My Brass Parlour')).toBe('my-brass-parlour');
    expect(draftIdFromName('  Café  Noir! ')).toBe('cafe-noir');
    expect(draftIdFromName('1920s')).toBe('theme-1920s');
    expect(draftIdFromName('???')).toBe('theme');
  });

  it('gives a new draft a free id: against other drafts, the registry and the default', async () => {
    const a = await createDraft({ name: 'Parlour' });
    const b = await createDraft({ name: 'Parlour' });
    const c = await createDraft({ name: 'Art Deco' });
    const d = await createDraft({ name: 'Default' });
    expect([a.id, b.id, c.id, d.id]).toEqual(['parlour', 'parlour-2', 'art-deco-2', 'default-2']);
  });

  it('serialises concurrent creates so two never share an id', async () => {
    const made = await Promise.all([createDraft({ name: 'Twin' }), createDraft({ name: 'Twin' }), createDraft({ name: 'Twin' })]);
    expect(made.map((d) => d.id).sort()).toEqual(['twin', 'twin-2', 'twin-3']);
  });

  it('a copy that fails part-way leaves no folder and frees its id (#226)', async () => {
    const realWrite = fake.storeModule.writeDraftFile;
    let calls = 0;
    const spy = jest.spyOn(fake.storeModule, 'writeDraftFile').mockImplementation(async (...args) => {
      if (++calls === 2) throw new Error('database is locked');
      return realWrite(...args);
    });
    try {
      await expect(createDraft({ name: 'Half Copy', from: 'madmans-box' })).rejects.toThrow('database is locked');
    } finally {
      spy.mockRestore();
    }
    const folders = await fake.storeModule.listDraftFolders();
    expect(folders.has('half-copy')).toBe(false);
    expect(await listDrafts()).toEqual([]);
    const retry = await createDraft({ name: 'Half Copy', from: 'madmans-box' });
    expect(retry.id).toBe('half-copy');
  });

  it('refuses an id that would leave the drafts folder', async () => {
    await expect(readDraft('../escape')).rejects.toThrow('No theme draft');
    await expect(readDraft('Themes')).rejects.toThrow('No theme draft');
    await expect(fake.storeModule.readDraftText(null, 'ok', '../other/theme.json')).rejects.toThrow();
  });
});

describe('create and read', () => {
  it('a blank draft is the default theme and validates clean', async () => {
    const draft = await createDraft({ name: 'Blank Slate' });
    expect(draft.issues).toEqual([]);
    expect(draft.tokens).toEqual({ primitives: {}, tokens: {}, choices: {} });
    expect(draft.manifest).toMatchObject({ id: 'blank-slate', name: 'Blank Slate', version: '0.1.0', formatVersion: 2 });
    expect(draft.uri).toBe('qtap://Quilltap General/Themes/blank-slate');
  });

  it.each(BUNDLED)('a copy of %s validates clean under its new id', async (from) => {
    const draft = await createDraft({ name: `My ${from}`, from });
    expect(errorsOf(draft)).toEqual([]);
    expect(draft.manifest).toMatchObject({ id: `my-${from}`, name: `My ${from}`, version: '0.1.0' });
    const source = themeRegistry.get(from)!;
    expect(draft.tokens).toEqual(
      JSON.parse(await fs.readFile(path.join(source.bundlePath!, 'tokens.json'), 'utf-8')),
    );
  });

  it('lists drafts, skipping folders that are not drafts', async () => {
    await createDraft({ name: 'Listed' });
    fake.put('Themes/Not An Id/theme.json', '{}');
    fake.put('Themes/no-manifest/tokens.json', '{}');
    fake.put('Themes/loose.json', '{}');
    const drafts = await listDrafts();
    expect(drafts.map((d) => d.id)).toEqual(['listed']);
    expect(drafts[0]).toMatchObject({ name: 'Listed', errorCount: 0, warningCount: 0 });
  });

  it('a broken tokens.json is an issue, and the draft still lists and opens', async () => {
    await createDraft({ name: 'Broken' });
    fake.put('Themes/broken/tokens.json', '{ "primitives": ');
    const draft = await readDraft('broken');
    expect(draft.tokens).toBeNull();
    expect(errorsOf(draft)[0]).toMatch(/tokens\.json: cannot be read as JSON/);
    expect((await listDrafts())[0]).toMatchObject({ id: 'broken', errorCount: 1 });
  });

  it('a manifest whose id does not match its folder is an error', async () => {
    await createDraft({ name: 'Moved' });
    const manifest = JSON.parse(fake.get('moved', 'theme.json')!.toString());
    fake.put('Themes/moved/theme.json', JSON.stringify({ ...manifest, id: 'elsewhere' }));
    expect(errorsOf(await readDraft('moved'))).toEqual([expect.stringMatching(/does not match the draft folder/)]);
  });
});

describe('save', () => {
  it('saves tokens against the revision read, and refuses a stale one', async () => {
    const draft = await createDraft({ name: 'Saver' });
    const tokens = { primitives: {}, tokens: { '--theme-primary': '#7a3' }, choices: {} };
    const saved = await writeDraftTokens('saver', { revision: draft.revision, tokens });
    expect(saved.revision).not.toBe(draft.revision);
    expect(saved.tokens?.tokens['--theme-primary']).toBe('#7a3');

    const stale = writeDraftTokens('saver', { revision: draft.revision, tokens: { ...tokens, tokens: {} } });
    await expect(stale).rejects.toBeInstanceOf(DraftRevisionConflictError);
    await expect(stale).rejects.toMatchObject({ currentRevision: saved.revision });
    expect((await readDraft('saver')).tokens?.tokens['--theme-primary']).toBe('#7a3');
  });

  it('a save that parses but does not validate is kept, with its issues', async () => {
    const draft = await createDraft({ name: 'Loose' });
    const saved = await writeDraftTokens('loose', {
      revision: draft.revision,
      tokens: { primitives: {}, tokens: { '--theme-not-a-token': 'red' }, choices: {} },
    });
    expect(saved.tokens?.tokens['--theme-not-a-token']).toBe('red');
    expect(errorsOf(saved).join(' ')).toMatch(/--theme-not-a-token/);
  });

  it('edits the name and description, and nothing else in theme.json', async () => {
    await createDraft({ name: 'Named' });
    const before = JSON.parse(fake.get('named', 'theme.json')!.toString());
    const after = await writeDraftManifestFields('named', { name: 'Renamed', description: 'A room.' });
    expect(after.manifest).toEqual({ ...before, name: 'Renamed', description: 'A room.' });
  });

  it('deletes the whole draft', async () => {
    await createDraft({ name: 'Doomed', from: 'rains' });
    await deleteDraft('doomed');
    expect([...fake.files.keys()].filter((k) => k.startsWith('Themes/doomed/'))).toEqual([]);
    await expect(readDraft('doomed')).rejects.toThrow('No theme draft');
  });
});

describe('install', () => {
  it('bumps the patch version', () => {
    expect(bumpPatch('0.1.0')).toBe('0.1.1');
    expect(bumpPatch('2.3.9-beta')).toBe('2.3.10');
    expect(bumpPatch('1.2')).toBe('1.2.1');
  });

  it('refuses a draft with errors, and installs nothing', async () => {
    const draft = await createDraft({ name: 'Unready' });
    await writeDraftTokens('unready', { revision: draft.revision, tokens: { primitives: {}, tokens: { '--nope': 'x' }, choices: {} } });
    await expect(installDraft('unready')).rejects.toBeInstanceOf(DraftNotInstallableError);
    expect(themeRegistry.has('unready')).toBe(false);
  });

  it('refuses an id a bundled theme holds', async () => {
    await fake.seedFromDir('rains', path.join(REPO_ROOT, 'themes/bundled/rains'));
    await expect(installDraft('rains')).rejects.toThrow(/ships with Quilltap/);
  });

  it('installs a valid draft, converting its PNG to WebP while the draft keeps the PNG', async () => {
    await fake.seedFromDir('sample', FIXTURE);
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#a83' } }).png().toBuffer();
    fake.put('Themes/sample/textures/grain.png', png);
    const manifest = JSON.parse(fake.get('sample', 'theme.json')!.toString());
    fake.put('Themes/sample/theme.json', JSON.stringify({ ...manifest, id: 'sample', version: '0.4.0', previewImage: 'textures/grain.png' }));

    const draft = await readDraft('sample');
    expect(errorsOf(draft)).toEqual([]);

    const result = await installDraft('sample');
    expect(result).toMatchObject({ themeId: 'sample', version: '0.4.0', draftVersion: '0.4.1' });
    expect(result.conversion.converted).toEqual({ 'textures/grain.png': 'textures/grain.webp' });

    const installed = path.join(mockThemesDir, 'sample');
    const installedManifest = JSON.parse(await fs.readFile(path.join(installed, 'theme.json'), 'utf-8'));
    expect(installedManifest.previewImage).toBe('textures/grain.webp');
    await expect(fs.access(path.join(installed, 'textures/grain.png'))).rejects.toThrow();
    expect((await sharp(await fs.readFile(path.join(installed, 'textures/grain.webp'))).metadata()).format).toBe('webp');

    expect(fake.get('sample', 'textures/grain.png')!.equals(png)).toBe(true);
    expect((await readDraft('sample')).version).toBe('0.4.1');

    expect(themeRegistry.get('sample')?.version).toBe('0.4.0');
    expect(publishRealtime).toHaveBeenCalledWith('themes', 'sample');
  });
});

describe('serving a draft', () => {
  beforeEach(async () => {
    await fake.seedFromDir('served', FIXTURE);
    const manifest = JSON.parse(fake.get('served', 'theme.json')!.toString());
    fake.put('Themes/served/theme.json', JSON.stringify({ ...manifest, id: 'served', version: '0.2.0' }));
    fake.put('Themes/served/notes/secret.txt', 'not referenced');
  });

  const MIME = { '.woff2': 'font/woff2', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8' };

  it('round-trips a font byte for byte, uncached', async () => {
    const res = await serveDraftThemeFile({
      themeId: 'served', file: 'fonts/RethinkSans-latin-ext.woff2', kind: 'font', version: '0.2.0', mimeTypes: MIME,
    });
    expect(res?.status).toBe(200);
    expect(res?.headers.get('Cache-Control')).toBe('no-cache');
    const original = await fs.readFile(path.join(FIXTURE, 'fonts/RethinkSans-latin-ext.woff2'));
    expect(Buffer.from(mockServedBytes[mockServedBytes.length - 1]).equals(original)).toBe(true);
  });

  it('serves a referenced asset', async () => {
    const res = await serveDraftThemeFile({ themeId: 'served', file: 'textures/paper.webp', kind: 'asset', version: '0.2.0', mimeTypes: MIME });
    expect(res?.status).toBe(200);
  });

  it('lists every image file in the draft, and serves one its CSS does not name', async () => {
    fake.put('Themes/served/textures/unused.png', Buffer.from('not really a png'));
    const draft = await readDraft('served');
    expect(draft.images.map((i) => i.path)).toContain('textures/unused.png');
    expect(draft.images.find((i) => i.path === 'textures/unused.png')).toEqual({
      path: 'textures/unused.png',
      type: 'image/png',
      url: '/api/themes/assets/bundle:served/textures/unused.png?v=0.2.0',
    });
    expect(draft.images.some((i) => i.path.endsWith('.txt') || i.path.endsWith('.woff2'))).toBe(false);
    const res = await serveDraftThemeFile({
      themeId: 'served', file: 'textures/unused.png', kind: 'asset', version: '0.2.0', mimeTypes: { ...MIME, '.png': 'image/png' },
    });
    expect(res?.status).toBe(200);
  });

  it('serves nothing outside the served set, at another version, or for a font asked as an asset', async () => {
    const ask = (file: string, kind: 'asset' | 'font', version: string | null) =>
      serveDraftThemeFile({ themeId: 'served', file, kind, version, mimeTypes: MIME });
    expect(await ask('notes/secret.txt', 'asset', '0.2.0')).toBeNull();
    expect(await ask('theme.json', 'asset', '0.2.0')).toBeNull();
    expect(await ask('textures/paper.webp', 'asset', '0.1.0')).toBeNull();
    expect(await ask('textures/paper.webp', 'asset', null)).toBeNull();
    expect(await ask('textures/paper.webp', 'font', '0.2.0')).toBeNull();
  });
});
