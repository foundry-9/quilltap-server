/**
 * Stable prompt and scenario ids, written one file at a time (D5, D6 of
 * refactor-character-repository-and-vault.md).
 *
 * A prompt's id used to be a hash of its path, so renaming it changed its id
 * and stranded `chats.selectedSystemPromptId`; `addSystemPrompt` returned an
 * id no later read would return; every save re-projected the whole folder.
 * Now the id lives in the file's frontmatter (falling back to the old path
 * hash, so nothing already referenced breaks), and each operation touches only
 * its own file.
 *
 * The vault is an in-memory map behind the real repository, hydrator and
 * per-item writers.
 */

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

jest.mock('@/lib/repositories/factory');

const vault = new Map<string, { content: string; createdAt: string; updatedAt: string }>();
const NOW = '2026-11-09T00:00:00.000Z';
const MOUNT = '22222222-2222-4222-8222-222222222222';

function docAt(relativePath: string) {
  const f = vault.get(relativePath)!;
  return {
    id: relativePath, mountPointId: MOUNT, relativePath,
    fileName: relativePath.slice(relativePath.lastIndexOf('/') + 1),
    content: f.content, createdAt: f.createdAt, updatedAt: f.updatedAt, lastModified: f.updatedAt,
  };
}

jest.mock('@/lib/mount-index/database-store', () => ({
  writeDatabaseDocument: jest.fn(async (_mp: string, p: string, content: string) => {
    const prior = vault.get(p);
    vault.set(p, { content, createdAt: prior?.createdAt ?? NOW, updatedAt: NOW });
    return { mtime: 0 };
  }),
  readDatabaseDocumentIfExists: jest.fn(async (_mp: string, p: string) => vault.get(p)?.content ?? null),
  deleteDatabaseDocument: jest.fn(async (_mp: string, p: string) => vault.delete(p)),
  DatabaseStoreError: class extends Error {},
}));

jest.mock('@/lib/mount-index/folder-paths', () => ({
  ensureFolderPath: jest.fn().mockResolvedValue(undefined),
}));

const sweepMock = jest.fn().mockResolvedValue(1);
jest.mock('@/lib/documents/core', () => ({
  renameDocument: jest.fn(async (from: { relativePath: string }, to: { relativePath: string }) => {
    const f = vault.get(from.relativePath);
    if (!f) return { ok: false, reason: 'source-missing' };
    vault.delete(from.relativePath);
    vault.set(to.relativePath, f);
    return { ok: true };
  }),
  deleteDocument: jest.fn(async (r: { relativePath: string }) => (vault.delete(r.relativePath) ? 'deleted' : 'not-found')),
  sweepChatDocumentsAfterMove: (...args: unknown[]) => sweepMock(...args),
}));

import { CharactersRepository } from '@/lib/database/repositories/characters.repository';
import { stableUuidFromString } from '@/lib/utils/stable-uuid';
import { parseFrontmatter } from '@/lib/doc-edit/markdown-parser';

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;

const CHAR_ID = '11111111-1111-4111-8111-111111111111';
let row: Record<string, unknown>;
let repo: CharactersRepository;
let rawReads = 0;

function folder(name: string) {
  return Array.from(vault.keys()).filter((p) => p.startsWith(`${name}/`)).map(docAt);
}

beforeEach(() => {
  jest.clearAllMocks();
  vault.clear();
  rawReads = 0;
  vault.set('properties.json', { content: JSON.stringify({ pronouns: null, aliases: [], title: null, firstMessage: null, talkativeness: 0.5 }), createdAt: NOW, updatedAt: NOW });
  row = {
    id: CHAR_ID, userId: '33333333-3333-4333-8333-333333333333', name: 'Tess',
    tags: [], partnerLinks: [], avatarOverrides: [], isFavorite: false, npc: false, controlledBy: 'llm',
    characterDocumentMountPointId: MOUNT, defaultSystemPromptId: null,
    createdAt: NOW, updatedAt: NOW,
  };
  getRepositoriesMock.mockReturnValue({
    docMountDocuments: {
      findManyByMountPointsInFolder: jest.fn(async (_ids: string[], name: string) => folder(name)),
      findManyByMountPointsAndPath: jest.fn(async (_ids: string[], p: string) => (vault.has(p) ? [docAt(p)] : [])),
      findByMountPointAndPath: jest.fn(async (_mp: string, p: string) => (vault.has(p) ? docAt(p) : null)),
    },
    docMountPoints: { findById: jest.fn(async () => ({ id: MOUNT, name: 'Tess Character Vault' })) },
  });
  repo = new CharactersRepository();
  jest.spyOn(repo, 'findByIdRaw').mockImplementation(async () => {
    rawReads++;
    return { ...row } as any;
  });
  (repo as any)._findById = jest.fn(async () => ({ ...row }));
  (repo as any).getCollection = jest.fn(async () => ({
    updateOne: jest.fn(async (_f: unknown, spec: { $set: Record<string, unknown> }) => {
      row = { ...row, ...spec.$set };
    }),
  }));
});

const fm = (p: string) => parseFrontmatter(vault.get(p)!.content).data ?? {};

describe('prompt ids survive a rename', () => {
  it('a legacy file keeps its path-derived id, gains it in frontmatter on first write, and keeps it through a rename', async () => {
    vault.set('Prompts/Formal.md', { content: '---\nname: Formal\nisDefault: true\n---\n\nSpeak formally.', createdAt: NOW, updatedAt: NOW });
    const legacyId = stableUuidFromString(`prompt:${MOUNT}:Prompts/Formal.md`);

    // The id a chat recorded before this change.
    const before = await repo.findById(CHAR_ID);
    expect(before!.systemPrompts.map((p) => p.id)).toEqual([legacyId]);
    const selectedSystemPromptId = before!.systemPrompts[0].id;

    // A content edit stamps the current id into the file.
    await repo.updateSystemPrompt(CHAR_ID, legacyId, { content: 'Speak very formally.' });
    expect(fm('Prompts/Formal.md').id).toBe(legacyId);

    // A rename moves the file and keeps the id.
    await repo.updateSystemPrompt(CHAR_ID, legacyId, { name: 'Ceremonial' });
    expect(vault.has('Prompts/Formal.md')).toBe(false);
    expect(fm('Prompts/Ceremonial.md').id).toBe(legacyId);
    expect(sweepMock).toHaveBeenCalledWith(expect.objectContaining({
      oldFilePath: 'Prompts/Formal.md',
      newFilePath: 'Prompts/Ceremonial.md',
    }));

    const after = await repo.findById(CHAR_ID);
    expect(after!.systemPrompts.find((p) => p.id === selectedSystemPromptId)?.name).toBe('Ceremonial');
  });

  it('a prompt edit reads the row once and hydrates nothing', async () => {
    vault.set('Prompts/Formal.md', { content: '---\nname: Formal\nisDefault: true\n---\n\nSpeak formally.', createdAt: NOW, updatedAt: NOW });
    const id = stableUuidFromString(`prompt:${MOUNT}:Prompts/Formal.md`);
    row.defaultSystemPromptId = id;
    const findById = jest.spyOn(repo, 'findById');

    await repo.updateSystemPrompt(CHAR_ID, id, { content: 'Speak very formally.' });

    expect(rawReads).toBe(1);
    expect(findById).not.toHaveBeenCalled();
  });
});

describe('adds return the id every later read returns', () => {
  it('addSystemPrompt: the returned id is real, is the default, and the column names it', async () => {
    const added = await repo.addSystemPrompt(CHAR_ID, { name: 'Formal', content: 'Speak formally.', isDefault: false });
    const read = await repo.findById(CHAR_ID);
    expect(read!.systemPrompts.map((p) => p.id)).toEqual([added!.id]);
    expect(read!.systemPrompts[0].isDefault).toBe(true);
    expect(row.defaultSystemPromptId).toBe(added!.id);
  });

  it('moving the default moves the column with it', async () => {
    const a = await repo.addSystemPrompt(CHAR_ID, { name: 'A', content: 'a', isDefault: false });
    const b = await repo.addSystemPrompt(CHAR_ID, { name: 'B', content: 'b', isDefault: true });
    expect(row.defaultSystemPromptId).toBe(b!.id);
    await repo.setDefaultSystemPrompt(CHAR_ID, a!.id);
    expect(row.defaultSystemPromptId).toBe(a!.id);
    expect(fm('Prompts/A.md').isDefault).toBe(true);
    expect(fm('Prompts/B.md').isDefault).toBeUndefined();
    await repo.deleteSystemPrompt(CHAR_ID, a!.id);
    expect(row.defaultSystemPromptId).toBe(b!.id);
  });

  it('addScenario: the returned id is real and survives a title change', async () => {
    const added = await repo.addScenario(CHAR_ID, { title: 'Harbour', content: 'Fog.', description: 'The first' });
    expect((await repo.findById(CHAR_ID))!.scenarios.map((s) => s.id)).toEqual([added!.id]);

    await repo.updateScenario(CHAR_ID, added!.id, { title: 'Old Harbour', archived: true });
    const [scenario] = (await repo.findById(CHAR_ID))!.scenarios;
    expect(scenario).toMatchObject({ id: added!.id, title: 'Old Harbour', archived: true, description: 'The first' });
    expect(vault.has('Scenarios/Old Harbour.md')).toBe(true);
  });
});

describe('per-item writes leave everything else alone', () => {
  it('never touches a hand-written draft', async () => {
    vault.set('Prompts/draft.md', { content: 'Notes to self.', createdAt: NOW, updatedAt: NOW });
    vault.set('Scenarios/half.md', { content: '# Half\n', createdAt: NOW, updatedAt: NOW });
    const p = await repo.addSystemPrompt(CHAR_ID, { name: 'Formal', content: 'x', isDefault: true });
    await repo.deleteSystemPrompt(CHAR_ID, p!.id);
    const s = await repo.addScenario(CHAR_ID, { title: 'Harbour', content: 'Fog.' });
    await repo.removeScenario(CHAR_ID, s!.id);
    expect(vault.get('Prompts/draft.md')!.content).toBe('Notes to self.');
    expect(vault.get('Scenarios/half.md')!.content).toBe('# Half\n');
  });

  it('gives a second prompt with the same name its own file', async () => {
    await repo.addSystemPrompt(CHAR_ID, { name: 'Formal', content: 'one', isDefault: false });
    await repo.addSystemPrompt(CHAR_ID, { name: 'Formal', content: 'two', isDefault: false });
    expect(vault.has('Prompts/Formal.md')).toBe(true);
    expect(vault.has('Prompts/Formal-1.md')).toBe(true);
  });

  it('refuses an archived character', async () => {
    row.archivedAt = NOW;
    await expect(repo.addScenario(CHAR_ID, { title: 'Harbour', content: 'Fog.' })).rejects.toThrow(/archived/);
  });

  it('refuses a whole-array write through update()', async () => {
    await expect(repo.update(CHAR_ID, { scenarios: [] } as any)).rejects.toThrow(/per-item/);
  });
});

/**
 * The default prompt is one fact in two places — the prompt's `isDefault`
 * flag and the row's `defaultSystemPromptId` column, which every reader
 * consults first (bug 154). Every prompt write moves both together. (Ported
 * from the old lockstep test, which stubbed the whole-array patch these
 * operations no longer build.)
 */
describe('the default prompt column moves with the flag', () => {
  async function twoPrompts() {
    const a = await repo.addSystemPrompt(CHAR_ID, { name: 'A', content: 'a', isDefault: false });
    const b = await repo.addSystemPrompt(CHAR_ID, { name: 'B', content: 'b', isDefault: false });
    return { a: a!, b: b! };
  }

  it('promoting a prompt drags the column along', async () => {
    const { b } = await twoPrompts();
    await repo.updateSystemPrompt(CHAR_ID, b.id, { isDefault: true });
    expect(row.defaultSystemPromptId).toBe(b.id);
    expect(fm('Prompts/A.md').isDefault).toBeUndefined();
  });

  it('an unrelated edit leaves the column on the standing default', async () => {
    const { a, b } = await twoPrompts();
    await repo.updateSystemPrompt(CHAR_ID, b.id, { content: 'changed' });
    expect(row.defaultSystemPromptId).toBe(a.id);
  });

  it('a non-default addition keeps the column on the standing default', async () => {
    const { a } = await twoPrompts();
    expect(row.defaultSystemPromptId).toBe(a.id);
  });

  it('deleting the default promotes the first remaining prompt, flag and column', async () => {
    const { a, b } = await twoPrompts();
    await repo.deleteSystemPrompt(CHAR_ID, a.id);
    expect(row.defaultSystemPromptId).toBe(b.id);
    expect(fm('Prompts/B.md').isDefault).toBe(true);
  });

  it('deleting the last prompt clears the column', async () => {
    const a = await repo.addSystemPrompt(CHAR_ID, { name: 'A', content: 'a', isDefault: true });
    await repo.deleteSystemPrompt(CHAR_ID, a!.id);
    expect(row.defaultSystemPromptId).toBeNull();
  });

  it('setDefaultSystemPrompt(null) clears both', async () => {
    await twoPrompts();
    await repo.setDefaultSystemPrompt(CHAR_ID, null);
    expect(row.defaultSystemPromptId).toBeNull();
    expect(fm('Prompts/A.md').isDefault).toBeUndefined();
  });

  it('refuses a prompt the character does not have, writing nothing', async () => {
    const { a } = await twoPrompts();
    const before = new Map(vault);
    expect(await repo.setDefaultSystemPrompt(CHAR_ID, '99999999-9999-4999-8999-999999999999')).toBeNull();
    expect(vault).toEqual(before);
    expect(row.defaultSystemPromptId).toBe(a.id);
  });
});

/**
 * The HTTP route's key-level fact-sheet patch (D11): set and unset keys,
 * merged server-side under one write chain, so two editors cannot race a
 * read-merge-replace. A sheet that is present but not an object is refused,
 * never merged over.
 */
describe('patchMetadata', () => {
  it('sets and unsets keys, keeping the rest', async () => {
    vault.set('metadata.json', { content: JSON.stringify({ keep: 1, drop: 2 }), createdAt: NOW, updatedAt: NOW });
    await repo.patchMetadata(CHAR_ID, { set: { added: true }, unset: ['drop'] });
    expect(JSON.parse(vault.get('metadata.json')!.content)).toEqual({ keep: 1, added: true });
  });

  it('serialises concurrent patches so neither is lost', async () => {
    vault.set('metadata.json', { content: '{}', createdAt: NOW, updatedAt: NOW });
    await Promise.all([
      repo.patchMetadata(CHAR_ID, { set: { a: 1 }, unset: [] }),
      repo.patchMetadata(CHAR_ID, { set: { b: 2 }, unset: [] }),
    ]);
    expect(JSON.parse(vault.get('metadata.json')!.content)).toEqual({ a: 1, b: 2 });
  });

  it('refuses to merge over a sheet that is not an object', async () => {
    vault.set('metadata.json', { content: '[1, 2]', createdAt: NOW, updatedAt: NOW });
    await expect(repo.patchMetadata(CHAR_ID, { set: { a: 1 }, unset: [] })).rejects.toThrow(/not a JSON object/);
    expect(vault.get('metadata.json')!.content).toBe('[1, 2]');
  });
});
