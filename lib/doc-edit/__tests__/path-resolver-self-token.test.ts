/**
 * Tests for the `mount_point: "self"` reserved token in the document-store path
 * resolver. The token maps to the acting character's OWN vault via the DB link
 * (characters.characterDocumentMountPointId), and only when a characterId is in
 * the resolution context — operator/non-character contexts fall through to
 * ordinary name/id matching.
 *
 * The tiered-mount-pool helpers are mocked to control the accessible set;
 * getRepositories is globally mocked by jest.setup and configured per-test.
 */

// ── Subject ─────────────────────────────────────────────────────────────────
import {
  resolveDocEditPath,
  PathResolutionError,
  SELF_VAULT_TOKEN,
  resolveSelfVaultMountPointId,
  resolveMountPointRef,
} from '../path-resolver';

// ── Mocks ─────────────────────────────────────────────────────────────────────
import { getRepositories } from '@/lib/repositories/factory';
import { resolveTieredMountPool, flattenTierPool } from '@/lib/mount-index/tiered-mount-pool';

jest.mock('@/lib/mount-index/tiered-mount-pool', () => ({
  resolveTieredMountPool: jest.fn(),
  flattenTierPool: jest.fn(),
}));

const ownVault = { id: 'vault-own', name: 'Ariadne Character Vault', enabled: true, mountType: 'database', basePath: '' };
const literalSelf = { id: 'store-literal', name: 'self', enabled: true, mountType: 'database', basePath: '' };

function mockAccessible(ids: string[], byId: Record<string, unknown>, ownVaultId: string | null) {
  jest.mocked(resolveTieredMountPool).mockResolvedValue({} as never);
  jest.mocked(flattenTierPool).mockReturnValue(ids);
  jest.mocked(getRepositories).mockReturnValue({
    characters: {
      findByIdRaw: jest.fn().mockResolvedValue({ id: 'c1', characterDocumentMountPointId: ownVaultId }),
    },
    docMountPoints: {
      findById: jest.fn().mockImplementation(async (id: string) => byId[id] ?? null),
    },
  } as never);
}

beforeEach(() => jest.clearAllMocks());

describe('self-token resolution', () => {
  it('maps "self" to the acting character own vault', async () => {
    mockAccessible(['vault-own'], { 'vault-own': ownVault }, 'vault-own');

    const resolved = await resolveDocEditPath('document_store', 'Mail/x.md', {
      characterId: 'c1',
      mountPoint: SELF_VAULT_TOKEN,
    });

    expect(resolved.mountPointId).toBe('vault-own');
    expect(resolved.relativePath).toBe('Mail/x.md');
  });

  it('is case-insensitive on the token', async () => {
    mockAccessible(['vault-own'], { 'vault-own': ownVault }, 'vault-own');
    const resolved = await resolveDocEditPath('document_store', 'Mail/x.md', {
      characterId: 'c1',
      mountPoint: 'SELF',
    });
    expect(resolved.mountPointId).toBe('vault-own');
  });

  it('throws NOT_FOUND when the character own vault is not accessible', async () => {
    // Own vault id present on the row but not in the accessible set.
    mockAccessible(['some-other'], { 'some-other': literalSelf }, 'vault-own');
    await expect(
      resolveDocEditPath('document_store', 'Mail/x.md', { characterId: 'c1', mountPoint: SELF_VAULT_TOKEN }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' } as Partial<PathResolutionError>);
  });

  it('falls through to a literal store named "self" when there is no characterId', async () => {
    mockAccessible(['store-literal'], { 'store-literal': literalSelf }, null);
    const resolved = await resolveDocEditPath('document_store', 'doc.md', {
      projectId: 'proj-1',
      mountPoint: 'self',
    });
    expect(resolved.mountPointId).toBe('store-literal');
  });
});

// The shared helper behind the self-token, reused by the list/grep/blob tool
// handlers that match a mount point by name/ID rather than via resolveDocEditPath.
describe('resolveSelfVaultMountPointId', () => {
  function mockCharacter(row: unknown) {
    jest.mocked(getRepositories).mockReturnValue({
      characters: { findByIdRaw: jest.fn().mockResolvedValue(row) },
    } as never);
  }

  it('returns the vault id from the character row', async () => {
    mockCharacter({ id: 'c1', characterDocumentMountPointId: 'vault-own' });
    await expect(resolveSelfVaultMountPointId('c1')).resolves.toBe('vault-own');
  });

  it('returns null without a characterId (no repo call)', async () => {
    await expect(resolveSelfVaultMountPointId(undefined)).resolves.toBeNull();
  });

  it('returns null when the character has no vault', async () => {
    mockCharacter({ id: 'c1', characterDocumentMountPointId: null });
    await expect(resolveSelfVaultMountPointId('c1')).resolves.toBeNull();
  });

  it('swallows a repo error and returns null', async () => {
    jest.mocked(getRepositories).mockReturnValue({
      characters: { findByIdRaw: jest.fn().mockRejectedValue(new Error('boom')) },
    } as never);
    await expect(resolveSelfVaultMountPointId('c1')).resolves.toBeNull();
  });
});

describe('resolveMountPointRef', () => {
  it('translates the self-token to the vault id (case-insensitive)', async () => {
    jest.mocked(getRepositories).mockReturnValue({
      characters: { findByIdRaw: jest.fn().mockResolvedValue({ id: 'c1', characterDocumentMountPointId: 'vault-own' }) },
    } as never);
    await expect(resolveMountPointRef('SELF', 'c1')).resolves.toBe('vault-own');
  });

  it('passes a non-self reference through unchanged (no repo call)', async () => {
    await expect(resolveMountPointRef('Quilltap General', 'c1')).resolves.toBe('Quilltap General');
  });

  it('passes "self" through unchanged when there is no character context', async () => {
    await expect(resolveMountPointRef('self', undefined)).resolves.toBe('self');
  });

  it('passes "self" through when the character has no vault, so a literal store stays reachable', async () => {
    jest.mocked(getRepositories).mockReturnValue({
      characters: { findByIdRaw: jest.fn().mockResolvedValue({ id: 'c1', characterDocumentMountPointId: null }) },
    } as never);
    await expect(resolveMountPointRef('self', 'c1')).resolves.toBe('self');
  });
});
