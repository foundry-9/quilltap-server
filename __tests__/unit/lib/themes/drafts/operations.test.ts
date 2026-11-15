/**
 * @jest-environment node
 *
 * Theme draft operations on the manifest and its files, and the install that
 * leaves out what nothing uses and converts TrueType to WOFF2 (Calliope Live,
 * Spec F §0.2–§0.4), over an in-memory Quilltap General. The registry, the
 * loader, the font reader and the WOFF2 encoder are real; installs land in a
 * temporary themes directory.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { decompress } from 'wawoff2';

const mockThemesDir = path.join(os.tmpdir(), `qtap-test-draft-ops-themes-${process.pid}-${Date.now()}`);

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
import { readFontInfo, sniffFontFormat } from '@/lib/themes/font-info';
import {
  addDraftFont,
  addDraftImage,
  addDraftLicenceFile,
  clearDraftIcon,
  DRAFT_LIMITS,
  DraftFileInUseError,
  DraftManifestInvalidError,
  DraftManifestRevisionConflictError,
  DraftManifestUnreadableError,
  DraftOperationRefusedError,
  DraftUploadRefusedError,
  installDraft,
  readDraft,
  readUploadedFont,
  removeDraftFile,
  removeDraftFont,
  setDraftIcon,
  setDraftManifestFields,
  setDraftSubsystem,
  updateDraftFont,
} from '@/lib/themes/drafts';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const FIXTURE = path.join(REPO_ROOT, '__tests__/fixtures/themes/v2-sample');
const LORA_WOFF2 = path.join(REPO_ROOT, 'themes/bundled/madmans-box/fonts/Lora-BoldItalic.woff2');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>');

let loraTtf: Buffer;

beforeAll(async () => {
  await fs.mkdir(mockThemesDir, { recursive: true });
  await themeRegistry.initialize();
  loraTtf = Buffer.from(await decompress(await fs.readFile(LORA_WOFF2)));
});

afterAll(async () => {
  await fs.rm(mockThemesDir, { recursive: true, force: true });
});

beforeEach(() => fake.reset());

const manifestOf = (id: string) => JSON.parse(fake.get(id, 'theme.json')!.toString());

/** Seed the version 2 fixture as draft `id`, with `patch` merged into its manifest. */
async function seed(id: string, patch: Record<string, unknown> = {}) {
  await fake.seedFromDir(id, FIXTURE);
  fake.put(`Themes/${id}/theme.json`, JSON.stringify({ ...manifestOf(id), id, version: '0.3.0', ...patch }, null, 2));
  return readDraft(id);
}

describe('the file list', () => {
  it('names every file\'s kind and users, and the totals', async () => {
    fake.put('Themes/listed/README.md', '# notes');
    const draft = await seed('listed');
    const font = draft.files.find((f) => f.path === 'fonts/RethinkSans-latin-ext.woff2')!;
    expect(font).toMatchObject({ kind: 'font', unused: false, usedBy: ['the font Rethink Sans'] });
    expect(font.font).toMatchObject({ family: 'Rethink Sans', variable: true });
    expect(draft.files.find((f) => f.path === 'textures/paper-dark.webp')).toMatchObject({ kind: 'image', unused: false });
    // `unused` marks only what the editor can remove (images, fonts, licence files).
    expect(draft.files.find((f) => f.path === 'README.md')).toMatchObject({ users: [], unused: false });
    expect(draft.totals.files).toBe(draft.files.length);
    expect(draft.totals.bytes).toBe(draft.files.reduce((n, f) => n + f.size, 0));
  });
});

describe('fonts', () => {
  it('reads an uploaded font, or guesses from its name when it cannot', () => {
    expect(readUploadedFont({ fileName: 'whatever.ttf', bytes: loraTtf })).toMatchObject({ read: true, info: { family: 'Lora', weight: '700', style: 'italic' } });
    const broken = Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(64, 3)]);
    expect(readUploadedFont({ fileName: 'Baskerville-SemiBold.ttf', bytes: broken })).toMatchObject({
      read: false,
      format: 'ttf',
      guess: { family: 'Baskerville', weight: '600' },
    });
  });

  it('adds a font under a safe name with what it read, and the chosen licence', async () => {
    const draft = await seed('fonts');
    const { draft: after, path: stored } = await addDraftFont('fonts', {
      revision: draft.manifestRevision,
      file: { fileName: '../My Lora (bold).ttf', bytes: loraTtf },
      license: 'OFL-1.1',
      licenseFile: 'fonts/OFL.txt',
    });
    expect(stored).toBe('fonts/My-Lora-bold.ttf');
    expect(fake.get('fonts', stored)!.equals(loraTtf)).toBe(true);
    expect(after.manifest?.fonts).toEqual([
      expect.objectContaining({ family: 'Rethink Sans' }),
      { family: 'Lora', src: stored, weight: '700', style: 'italic', display: 'swap', license: 'OFL-1.1', licenseFile: 'fonts/OFL.txt' },
    ]);
    expect(after.manifestRevision).not.toBe(draft.manifestRevision);
  });

  it('gives a colliding upload a suffix', async () => {
    const draft = await seed('collide');
    const { path: stored } = await addDraftFont('collide', {
      revision: draft.manifestRevision,
      file: { fileName: 'RethinkSans-latin-ext.woff2', bytes: await fs.readFile(path.join(FIXTURE, 'fonts/RethinkSans-latin-ext.woff2')) },
      license: 'OFL-1.1',
      family: 'Rethink Sans Copy',
    });
    expect(stored).toBe('fonts/RethinkSans-latin-ext-2.woff2');
  });

  it('refuses an extension that does not match its bytes, and writes nothing', async () => {
    const draft = await seed('mismatch');
    const before = fake.files.size;
    await expect(
      addDraftFont('mismatch', { revision: draft.manifestRevision, file: { fileName: 'Lora.woff2', bytes: loraTtf }, license: 'OFL-1.1' }),
    ).rejects.toBeInstanceOf(DraftUploadRefusedError);
    expect(fake.files.size).toBe(before);
  });

  it('refuses a licence the schema will not take, and writes nothing', async () => {
    const draft = await seed('badlicence');
    const before = fake.files.size;
    await expect(
      addDraftFont('badlicence', { revision: draft.manifestRevision, file: { fileName: 'Lora.ttf', bytes: loraTtf }, license: 'not a licence!' }),
    ).rejects.toBeInstanceOf(DraftManifestInvalidError);
    expect(fake.files.size).toBe(before);
  });

  it('updates a font entry and clears an optional field', async () => {
    const draft = await seed('update');
    const { draft: after } = await updateDraftFont('update', {
      revision: draft.manifestRevision,
      index: 0,
      fields: { family: ' Rethink ', display: null, license: 'proprietary' },
    });
    const font = (after.manifest?.fonts as Record<string, unknown>[])[0];
    expect(font).toMatchObject({ family: 'Rethink', license: 'proprietary' });
    expect(font).not.toHaveProperty('display');
    await expect(updateDraftFont('update', { revision: after.manifestRevision, index: 4, fields: { family: 'x' } })).rejects.toBeInstanceOf(DraftOperationRefusedError);
  });

  it('removes a font entry and deletes its file, but keeps a licence file', async () => {
    const draft = await seed('remove');
    const { draft: after, deleted } = await removeDraftFont('remove', { revision: draft.manifestRevision, index: 0 });
    expect(deleted).toEqual(['fonts/RethinkSans-latin-ext.woff2']);
    expect(after.manifest).not.toHaveProperty('fonts');
    expect(fake.get('remove', 'fonts/RethinkSans-latin-ext.woff2')).toBeUndefined();
    expect(fake.get('remove', 'fonts/OFL.txt')).toBeDefined();
  });

  it('adds a licence file under fonts/', async () => {
    const draft = await seed('licence');
    const { path: stored } = await addDraftLicenceFile('licence', {
      revision: draft.manifestRevision,
      file: { fileName: 'LICENSE.md', bytes: Buffer.from('# Licence') },
    });
    expect(stored).toBe('fonts/LICENSE.md');
  });
});

describe('the manifest revision', () => {
  it('refuses a stale revision with the current one, and writes nothing', async () => {
    const draft = await seed('stale');
    const { draft: after } = await setDraftManifestFields('stale', { revision: draft.manifestRevision, fields: { name: 'Fresh' } });
    const before = fake.get('stale', 'theme.json')!;
    const refusal = setDraftManifestFields('stale', { revision: draft.manifestRevision, fields: { name: 'Stale' } });
    await expect(refusal).rejects.toBeInstanceOf(DraftManifestRevisionConflictError);
    await expect(refusal).rejects.toMatchObject({ currentRevision: after.manifestRevision });
    expect(fake.get('stale', 'theme.json')!.equals(before)).toBe(true);
  });

  it('refuses an operation on a manifest broken from outside, with the reason, and leaves the file alone', async () => {
    await seed('broken');
    fake.put('Themes/broken/theme.json', '{ "id": "broken", oops');
    const broken = await readDraft('broken');
    const before = fake.get('broken', 'theme.json')!;
    await expect(
      setDraftManifestFields('broken', { revision: broken.manifestRevision, fields: { name: 'Mended' } }),
    ).rejects.toBeInstanceOf(DraftManifestUnreadableError);
    expect(fake.get('broken', 'theme.json')!.equals(before)).toBe(true);
  });

  it('refuses an edit to a manifest already invalid from outside, naming the problem', async () => {
    await seed('invalid', { tags: 'not a list' });
    const draft = await readDraft('invalid');
    const before = fake.get('invalid', 'theme.json')!;
    const refusal = setDraftManifestFields('invalid', { revision: draft.manifestRevision, fields: { name: 'Mended' } });
    await expect(refusal).rejects.toBeInstanceOf(DraftManifestInvalidError);
    await expect(refusal).rejects.toMatchObject({ errors: [expect.stringMatching(/^tags:/)] });
    expect(fake.get('invalid', 'theme.json')!.equals(before)).toBe(true);
  });
});

describe('images and files', () => {
  it('adds an image under images/', async () => {
    const draft = await seed('images');
    const { draft: after, path: stored } = await addDraftImage('images', { revision: draft.manifestRevision, file: { fileName: 'Grain Texture.PNG', bytes: PNG } });
    expect(stored).toBe('images/Grain-Texture.png');
    expect(after.files.find((f) => f.path === stored)).toMatchObject({ kind: 'image', unused: true });
  });

  it('refuses a file over the size limit', async () => {
    const draft = await seed('huge');
    const big = Buffer.concat([PNG, Buffer.alloc(DRAFT_LIMITS.fileBytes)]);
    await expect(addDraftImage('huge', { revision: draft.manifestRevision, file: { fileName: 'big.png', bytes: big } })).rejects.toMatchObject({
      reason: 'limit',
    });
  });

  it('refuses to remove a file something uses, naming its users', async () => {
    const draft = await seed('inuse');
    const refusal = removeDraftFile('inuse', { revision: draft.manifestRevision, path: 'textures/paper.webp' });
    await expect(refusal).rejects.toBeInstanceOf(DraftFileInUseError);
    await expect(refusal).rejects.toMatchObject({ users: expect.arrayContaining(['the background picture of salon', 'the custom CSS']) });
    expect(fake.get('inuse', 'textures/paper.webp')).toBeDefined();
  });

  it('removes an unused image, and refuses a file that is not an image, font or licence file', async () => {
    const draft = await seed('tidy');
    const { draft: added } = await addDraftImage('tidy', { revision: draft.manifestRevision, file: { fileName: 'spare.png', bytes: PNG } });
    await removeDraftFile('tidy', { revision: added.manifestRevision, path: 'images/spare.png' });
    expect(fake.get('tidy', 'images/spare.png')).toBeUndefined();
    await expect(removeDraftFile('tidy', { revision: added.manifestRevision, path: 'styles.css' })).rejects.toBeInstanceOf(DraftOperationRefusedError);
  });
});

describe('icons', () => {
  it('sets an icon override, named for the icon', async () => {
    const draft = await seed('icons');
    const { draft: after, path: stored } = await setDraftIcon('icons', { revision: draft.manifestRevision, name: 'moon', file: { fileName: 'crescent.svg', bytes: SVG } });
    expect(stored).toBe('icons/moon.svg');
    expect(after.manifest?.icons).toEqual({ sun: 'icons/sun.svg', moon: 'icons/moon.svg' });
  });

  it('replaces an icon\'s own file in place', async () => {
    const draft = await seed('replace');
    const { draft: after, path: stored } = await setDraftIcon('replace', { revision: draft.manifestRevision, name: 'sun', file: { fileName: 'new.svg', bytes: SVG } });
    expect(stored).toBe('icons/sun.svg');
    expect(fake.get('replace', 'icons/sun.svg')!.equals(SVG)).toBe(true);
    expect(after.files.filter((f) => f.path.startsWith('icons/'))).toHaveLength(1);
  });

  it('clears an override and deletes its file', async () => {
    const draft = await seed('clear');
    const { draft: after, deleted } = await clearDraftIcon('clear', { revision: draft.manifestRevision, name: 'sun' });
    expect(deleted).toEqual(['icons/sun.svg']);
    expect(after.manifest).not.toHaveProperty('icons');
    await expect(clearDraftIcon('clear', { revision: after.manifestRevision, name: 'sun' })).rejects.toBeInstanceOf(DraftOperationRefusedError);
  });

  it('refuses an icon name Quilltap does not have', async () => {
    const draft = await seed('unknown-icon');
    await expect(
      setDraftIcon('unknown-icon', { revision: draft.manifestRevision, name: 'not-an-icon', file: { fileName: 'x.svg', bytes: SVG } }),
    ).rejects.toThrow(/not one of Quilltap's icons/);
    expect(fake.get('unknown-icon', 'icons/not-an-icon.svg')).toBeUndefined();
  });
});

describe('subsystems', () => {
  it('sets and clears a subsystem\'s fields, dropping an empty entry', async () => {
    const draft = await seed('subs');
    const { draft: set } = await setDraftSubsystem('subs', {
      revision: draft.manifestRevision,
      subsystem: 'salon',
      fields: { description: ' Where talk happens ', thumbnail: 'textures/paper-dark.webp' },
    });
    expect((set.manifest?.subsystems as Record<string, unknown>).salon).toEqual({
      name: 'The Parlour',
      backgroundImage: 'textures/paper.webp',
      description: 'Where talk happens',
      thumbnail: 'textures/paper-dark.webp',
    });
    const { draft: cleared } = await setDraftSubsystem('subs', { revision: set.manifestRevision, subsystem: 'lantern', fields: { thumbnail: '' } });
    expect(cleared.manifest?.subsystems).not.toHaveProperty('lantern');
  });

  it('refuses an unknown subsystem, and a picture that is not a draft image', async () => {
    const draft = await seed('badsub');
    await expect(setDraftSubsystem('badsub', { revision: draft.manifestRevision, subsystem: 'kitchen', fields: { name: 'x' } })).rejects.toThrow(
      /not one of Quilltap's subsystems/,
    );
    await expect(
      setDraftSubsystem('badsub', { revision: draft.manifestRevision, subsystem: 'salon', fields: { thumbnail: 'fonts/OFL.txt' } }),
    ).rejects.toThrow(/not an image/);
  });
});

describe('the manifest\'s own fields', () => {
  it('sets and clears fields, and never changes the id', async () => {
    const draft = await seed('fields');
    const { draft: after } = await setDraftManifestFields('fields', {
      revision: draft.manifestRevision,
      fields: { author: { name: 'A. Writer' }, tags: [' brass ', ''], description: null, previewImage: 'textures/paper.webp', supportsDarkMode: false },
    });
    expect(after.manifest).toMatchObject({ id: 'fields', author: { name: 'A. Writer' }, tags: ['brass'], previewImage: 'textures/paper.webp', supportsDarkMode: false });
    expect(after.manifest).not.toHaveProperty('description');
    await expect(
      setDraftManifestFields('fields', { revision: after.manifestRevision, fields: { previewImage: 'nowhere.png' } }),
    ).rejects.toBeInstanceOf(DraftOperationRefusedError);
  });
});

describe('install', () => {
  it('converts a .ttf to WOFF2 in the install while the draft keeps the .ttf', async () => {
    const draft = await seed('ttfinstall');
    await addDraftFont('ttfinstall', { revision: draft.manifestRevision, file: { fileName: 'Lora-BoldItalic.ttf', bytes: loraTtf }, license: 'OFL-1.1' });

    const result = await installDraft('ttfinstall');
    expect(result.fontConversion).toEqual({ 'fonts/Lora-BoldItalic.ttf': 'fonts/Lora-BoldItalic.woff2' });

    const installed = path.join(mockThemesDir, 'ttfinstall');
    const manifest = JSON.parse(await fs.readFile(path.join(installed, 'theme.json'), 'utf-8'));
    expect(manifest.fonts[1].src).toBe('fonts/Lora-BoldItalic.woff2');
    await expect(fs.access(path.join(installed, 'fonts/Lora-BoldItalic.ttf'))).rejects.toThrow();
    const woff2 = await fs.readFile(path.join(installed, 'fonts/Lora-BoldItalic.woff2'));
    expect(sniffFontFormat(woff2)).toBe('woff2');
    expect(readFontInfo(woff2)).toMatchObject({ ok: true, info: { family: 'Lora', weight: '700' } });

    expect(fake.get('ttfinstall', 'fonts/Lora-BoldItalic.ttf')!.equals(loraTtf)).toBe(true);
    expect((manifestOf('ttfinstall').fonts as { src: string }[])[1].src).toBe('fonts/Lora-BoldItalic.ttf');
  });

  it('packs a .woff as it is', async () => {
    const woff = Buffer.concat([Buffer.from('wOFF'), Buffer.alloc(60, 1)]);
    const draft = await seed('woffinstall');
    await addDraftFont('woffinstall', {
      revision: draft.manifestRevision,
      file: { fileName: 'Old-Regular.woff', bytes: woff },
      license: 'proprietary',
    });
    const result = await installDraft('woffinstall');
    expect(result.fontConversion).toEqual({});
    expect((await fs.readFile(path.join(mockThemesDir, 'woffinstall/fonts/Old-Regular.woff'))).equals(woff)).toBe(true);
  });

  it('leaves out an unused font and image, and keeps a README', async () => {
    await seed('leanest');
    fake.put('Themes/leanest/fonts/Spare.woff2', await fs.readFile(LORA_WOFF2));
    fake.put('Themes/leanest/images/spare.png', PNG);
    fake.put('Themes/leanest/README.md', '# About this theme');

    const result = await installDraft('leanest');
    expect(result.leftOut.sort()).toEqual(['fonts/Spare.woff2', 'images/spare.png']);
    const installed = path.join(mockThemesDir, 'leanest');
    await expect(fs.access(path.join(installed, 'fonts/Spare.woff2'))).rejects.toThrow();
    await expect(fs.access(path.join(installed, 'images/spare.png'))).rejects.toThrow();
    await expect(fs.access(path.join(installed, 'README.md'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(installed, 'fonts/OFL.txt'))).resolves.toBeUndefined();
    expect(fake.get('leanest', 'images/spare.png')).toBeDefined();
  });
});
