import {
  resolveCharacterAvatar,
  buildMountFileUrl,
  buildLegacyFileUrl,
  readCharacterAvatarBuffer,
} from '@/lib/photos/resolve-character-avatar';

interface FakeRepos {
  files: {
    findById: jest.Mock;
  };
  docMountFileLinks: {
    findByIdWithContent: jest.Mock;
  };
  docMountBlobs: {
    readDataByFileId: jest.Mock;
  };
}

function buildRepos(): FakeRepos {
  return {
    files: { findById: jest.fn() },
    docMountFileLinks: { findByIdWithContent: jest.fn() },
    docMountBlobs: { readDataByFileId: jest.fn() },
  };
}

const VAULT_ID = '11111111-1111-4111-8111-111111111111';
const LINK_ID = '22222222-2222-4222-8222-222222222222';
const FILE_ID = '33333333-3333-4333-8333-333333333333';
const SHA = 'a'.repeat(64);

describe('resolveCharacterAvatar', () => {
  it('returns null when id is null/undefined/empty', async () => {
    const repos = buildRepos();
    expect(await resolveCharacterAvatar(null, repos as any)).toBeNull();
    expect(await resolveCharacterAvatar(undefined, repos as any)).toBeNull();
    expect(await resolveCharacterAvatar('', repos as any)).toBeNull();
    expect(repos.docMountFileLinks.findByIdWithContent).not.toHaveBeenCalled();
    expect(repos.files.findById).not.toHaveBeenCalled();
  });

  it('resolves a vault link id to a mount-blob URL with vault-link kind', async () => {
    const repos = buildRepos();
    repos.docMountFileLinks.findByIdWithContent.mockResolvedValue({
      id: LINK_ID,
      fileId: FILE_ID,
      mountPointId: VAULT_ID,
      relativePath: 'photos/2026-05-15-alice.webp',
      originalMimeType: 'image/webp',
      sha256: SHA,
    });

    const result = await resolveCharacterAvatar(LINK_ID, repos as any);

    expect(result).toEqual({
      id: LINK_ID,
      kind: 'vault-link',
      url: `/api/v1/mount-points/${VAULT_ID}/blobs/photos/2026-05-15-alice.webp`,
      mimeType: 'image/webp',
      sha256: SHA,
      mountPointId: VAULT_ID,
      relativePath: 'photos/2026-05-15-alice.webp',
    });
    // We hit the vault path; never fall through to the legacy files lookup.
    expect(repos.files.findById).not.toHaveBeenCalled();
  });

  it('encodes URL-special characters in the relative path', async () => {
    const repos = buildRepos();
    repos.docMountFileLinks.findByIdWithContent.mockResolvedValue({
      id: LINK_ID,
      fileId: FILE_ID,
      mountPointId: VAULT_ID,
      relativePath: 'photos/some image with spaces & ampersand.webp',
      originalMimeType: 'image/webp',
      sha256: SHA,
    });

    const result = await resolveCharacterAvatar(LINK_ID, repos as any);

    expect(result?.url).toBe(
      `/api/v1/mount-points/${VAULT_ID}/blobs/${encodeURI('photos/some image with spaces & ampersand.webp')}`
    );
  });

  it('falls back to the legacy files table when no vault link exists', async () => {
    const repos = buildRepos();
    repos.docMountFileLinks.findByIdWithContent.mockResolvedValue(null);
    repos.files.findById.mockResolvedValue({
      id: FILE_ID,
      mimeType: 'image/png',
      sha256: SHA,
    });

    const result = await resolveCharacterAvatar(FILE_ID, repos as any);

    expect(result).toEqual({
      id: FILE_ID,
      kind: 'legacy-file',
      url: `/api/v1/files/${FILE_ID}`,
      mimeType: 'image/png',
      sha256: SHA,
      mountPointId: null,
      relativePath: null,
    });
  });

  it('returns null when neither lookup finds the id', async () => {
    const repos = buildRepos();
    repos.docMountFileLinks.findByIdWithContent.mockResolvedValue(null);
    repos.files.findById.mockResolvedValue(null);

    const result = await resolveCharacterAvatar('nonexistent', repos as any);
    expect(result).toBeNull();
  });

  it('handles a link row missing optional fields without throwing', async () => {
    const repos = buildRepos();
    repos.docMountFileLinks.findByIdWithContent.mockResolvedValue({
      id: LINK_ID,
      fileId: FILE_ID,
      mountPointId: VAULT_ID,
      relativePath: 'photos/x.webp',
      // originalMimeType + sha256 are typed as optional/nullable on the
      // link row; the resolver should still produce a usable shape.
      originalMimeType: null,
      sha256: '',
    });

    const result = await resolveCharacterAvatar(LINK_ID, repos as any);

    expect(result).toMatchObject({
      kind: 'vault-link',
      mimeType: null,
      sha256: null,
    });
  });
});

describe('readCharacterAvatarBuffer', () => {
  it('returns null when id is empty', async () => {
    const repos = buildRepos();
    expect(await readCharacterAvatarBuffer(null, repos as any)).toBeNull();
    expect(await readCharacterAvatarBuffer('', repos as any)).toBeNull();
  });

  it('reads vault link bytes via docMountBlobs.readDataByFileId', async () => {
    const repos = buildRepos();
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    repos.docMountFileLinks.findByIdWithContent.mockResolvedValue({
      id: LINK_ID,
      fileId: FILE_ID,
      mountPointId: VAULT_ID,
      relativePath: 'images/avatar.webp',
    });
    repos.docMountBlobs.readDataByFileId.mockResolvedValue(bytes);

    const result = await readCharacterAvatarBuffer(LINK_ID, repos as any);

    expect(result).toBe(bytes);
    expect(repos.docMountBlobs.readDataByFileId).toHaveBeenCalledWith(FILE_ID);
  });
});

describe('buildMountFileUrl / buildLegacyFileUrl', () => {
  it('formats vault link URLs', () => {
    expect(buildMountFileUrl(VAULT_ID, 'photos/x.webp')).toBe(
      `/api/v1/mount-points/${VAULT_ID}/blobs/photos/x.webp`
    );
  });

  it('formats legacy file URLs', () => {
    expect(buildLegacyFileUrl('abc')).toBe('/api/v1/files/abc');
  });
});
