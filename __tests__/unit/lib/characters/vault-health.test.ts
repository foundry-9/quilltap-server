/**
 * A broken vault is reported and repairable, never auto-rewritten (D1, D10).
 *
 * `inspectCharacterVault` answers from the row and the file list — no
 * hydration, so it works on exactly the characters `findById` refuses.
 * `repairCharacterVault` seeds an absent `properties.json` / `metadata.json`
 * and writes nothing else; a present file that fails to parse is reported and
 * left for the operator.
 */

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});
jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('@/lib/repositories/factory');

const vault = new Map<string, string>();
jest.mock('@/lib/mount-index/database-store', () => ({
  writeDatabaseDocument: jest.fn(async (_mp: string, p: string, content: string) => {
    vault.set(p, content);
    return { mtime: 0 };
  }),
}));
jest.mock('@/lib/mount-index/folder-paths', () => ({ ensureFolderPath: jest.fn() }));
jest.mock('@/lib/mount-index/character-vault', () => ({
  ensureCharacterVault: jest.fn().mockResolvedValue({ mountPointId: 'mp-new', created: true }),
}));

import { inspectCharacterVault, repairCharacterVault } from '@/lib/characters/vault/health';
import { writeDatabaseDocument } from '@/lib/mount-index/database-store';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';

const getRepositoriesMock = jest.requireMock('@/lib/repositories/factory').getRepositories as jest.Mock;
const writeMock = writeDatabaseDocument as jest.Mock;

const ROW = { id: 'char-1', name: 'Tess', characterDocumentMountPointId: 'mp-1' } as any;
const IDENTITY = 'A keeper of the light.';

beforeEach(() => {
  jest.clearAllMocks();
  vault.clear();
  vault.set('identity.md', IDENTITY);
  getRepositoriesMock.mockReturnValue({
    docMountPoints: { findById: jest.fn(async (id: string) => (id === 'mp-1' ? { id, name: 'Tess Character Vault' } : null)) },
    docMountDocuments: {
      findByMountPointAndPath: jest.fn(async (_mp: string, p: string) => (vault.has(p) ? { relativePath: p, content: vault.get(p) } : null)),
    },
  });
});

describe('inspectCharacterVault', () => {
  it('reports an invalid properties.json with its parse error, and as unreadable', async () => {
    vault.set('properties.json', JSON.stringify({ pronouns: null, aliases: [], title: null, firstMessage: null, talkativeness: 0 }));

    const health = await inspectCharacterVault(ROW);

    expect(health.linked).toBe(true);
    expect(health.readable).toBe(false);
    expect(health.needsAttention).toEqual(['properties.json']);
    expect(health.files.find((f) => f.path === 'properties.json')).toMatchObject({ present: true, parses: false, keystone: true });
    expect(health.files.find((f) => f.path === 'properties.json')!.error).toMatch(/talkativeness/);
    expect(health.repairable).toEqual(['metadata.json']);
  });

  it('reports an absent anchor as repairable', async () => {
    const health = await inspectCharacterVault(ROW);
    expect(health.readable).toBe(false);
    expect(health.repairable).toEqual(['properties.json', 'metadata.json']);
    expect(health.needsAttention).toEqual([]);
  });

  it('reports a vault that does not exist', async () => {
    const health = await inspectCharacterVault({ ...ROW, characterDocumentMountPointId: 'gone' });
    expect(health.linked).toBe(false);
    expect(health.files.every((f) => !f.present)).toBe(true);
  });
});

describe('repairCharacterVault', () => {
  it('seeds absent keystones and writes nothing else', async () => {
    const { seeded, health } = await repairCharacterVault(ROW);
    expect(seeded).toEqual(['properties.json', 'metadata.json']);
    expect(writeMock.mock.calls.map(([, p]) => p).sort()).toEqual(['metadata.json', 'properties.json']);
    expect(vault.get('identity.md')).toBe(IDENTITY);
    expect(health.readable).toBe(true);
  });

  it('never rewrites a present-but-invalid keystone', async () => {
    const invalid = '{ "aliases": [], }';
    vault.set('properties.json', invalid);
    vault.set('metadata.json', '{}');
    const { seeded, health } = await repairCharacterVault(ROW);
    expect(seeded).toEqual([]);
    expect(writeMock).not.toHaveBeenCalled();
    expect(vault.get('properties.json')).toBe(invalid);
    expect(health.needsAttention).toEqual(['properties.json']);
  });

  it('scaffolds a vault for a character that has none', async () => {
    await repairCharacterVault({ ...ROW, characterDocumentMountPointId: null });
    expect(ensureCharacterVault).toHaveBeenCalledWith(expect.objectContaining({ id: 'char-1', characterDocumentMountPointId: null }));
  });

  it('refuses an archived character', async () => {
    await expect(repairCharacterVault({ ...ROW, archivedAt: '2026-11-09T00:00:00.000Z' })).rejects.toThrow(/archived/);
  });
});
