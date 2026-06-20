/**
 * Tests that the two project-less image bridges short-circuit to host-RPC when
 * running inside the forked job child (`QUILLTAP_JOB_CHILD === '1'`).
 *
 * In the child the DB connection is readonly and writes are buffered, so the
 * `linkBlobContent` insert these bridges issue — whose server-generated
 * `blobId`/`linkId` get baked into the returned `storageKey` and persisted into
 * `files.create` — cannot run there. The fix routes the whole write to the
 * parent's RW connection via `callHost(...)`. Both bridges are globally mocked
 * in jest.setup.ts, so we exercise the *real* implementations via requireActual.
 */

// The bridges dynamically import this at call time; mock it so we can assert the
// short-circuit without an IPC channel.
jest.mock('@/lib/background-jobs/child/host-rpc-client', () => ({
  callHost: jest.fn(),
}));

import { callHost } from '@/lib/background-jobs/child/host-rpc-client';
import { getRepositories } from '@/lib/repositories/factory';

const mockCallHost = jest.mocked(callHost);
const mockGetRepositories = jest.mocked(getRepositories);

// Real implementations (jest.setup.ts mocks the module exports app-wide).
const { writeCharacterAvatarToVault } = jest.requireActual(
  '@/lib/file-storage/character-vault-bridge',
);
const { writeLanternBackgroundToMountStore } = jest.requireActual(
  '@/lib/file-storage/lantern-store-bridge',
);

const ORIGINAL_ENV = process.env.QUILLTAP_JOB_CHILD;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.QUILLTAP_JOB_CHILD;
  else process.env.QUILLTAP_JOB_CHILD = ORIGINAL_ENV;
  jest.clearAllMocks();
});

describe('writeCharacterAvatarToVault — job-child short-circuit', () => {
  const input = {
    characterId: 'c1',
    kind: 'history' as const,
    filename: 'av.webp',
    content: Buffer.from('avatar-bytes'),
    contentType: 'image/webp',
    description: 'portrait',
  };

  it('routes to callHost and returns the real parent result, never touching the DB', async () => {
    process.env.QUILLTAP_JOB_CHILD = '1';
    const parentResult = {
      storageKey: 'mount-blob:m1:real-blob',
      mountPointId: 'm1',
      blobId: 'real-blob',
      linkId: 'real-link',
      relativePath: 'images/history/av.webp',
      storedMimeType: 'image/webp',
      sizeBytes: 12,
      sha256: 'sha',
    };
    mockCallHost.mockResolvedValueOnce(parentResult);

    const result = await writeCharacterAvatarToVault(input);

    expect(mockCallHost).toHaveBeenCalledTimes(1);
    expect(mockCallHost).toHaveBeenCalledWith('writeCharacterAvatarToVault', input);
    expect(result).toBe(parentResult);
    // The whole write went to the parent — no repo access in the child.
    expect(mockGetRepositories).not.toHaveBeenCalled();
  });

  it('does not short-circuit outside the job child', async () => {
    delete process.env.QUILLTAP_JOB_CHILD;
    // Outside the child there is no resolvable vault (getRepositories is an
    // un-stubbed jest.fn() → undefined), so the real path throws. The point is
    // that it took the real path, not host-RPC.
    await expect(writeCharacterAvatarToVault(input)).rejects.toThrow();
    expect(mockCallHost).not.toHaveBeenCalled();
  });
});

describe('writeLanternBackgroundToMountStore — job-child short-circuit', () => {
  const input = {
    filename: 'bg.webp',
    content: Buffer.from('bg-bytes'),
    contentType: 'image/webp',
    subfolder: 'generated' as const,
    description: 'scene',
  };

  it('routes to callHost and returns the real parent result, never touching the DB', async () => {
    process.env.QUILLTAP_JOB_CHILD = '1';
    const parentResult = {
      storageKey: 'mount-blob:lantern:real-blob',
      mountPointId: 'lantern',
      blobId: 'real-blob',
      relativePath: 'generated/bg.webp',
      storedMimeType: 'image/webp',
      sizeBytes: 8,
      sha256: 'sha',
    };
    mockCallHost.mockResolvedValueOnce(parentResult);

    const result = await writeLanternBackgroundToMountStore(input);

    expect(mockCallHost).toHaveBeenCalledTimes(1);
    expect(mockCallHost).toHaveBeenCalledWith(
      'writeLanternBackgroundToMountStore',
      input,
    );
    expect(result).toBe(parentResult);
    expect(mockGetRepositories).not.toHaveBeenCalled();
  });

  it('does not short-circuit outside the job child', async () => {
    delete process.env.QUILLTAP_JOB_CHILD;
    await expect(writeLanternBackgroundToMountStore(input)).rejects.toThrow();
    expect(mockCallHost).not.toHaveBeenCalled();
  });
});
