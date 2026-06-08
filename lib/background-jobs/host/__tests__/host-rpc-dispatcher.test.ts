/**
 * Tests for the host-side host-RPC dispatcher.
 *
 * The forked job child posts `host-rpc` requests for file-storage writes it
 * cannot perform on its readonly connection; the parent runs them here against
 * its RW layer and replies with a `host-rpc-response` envelope. The file-storage
 * manager and both project-less image bridges are globally mocked in
 * jest.setup.ts, so these tests assert the dispatcher routes each method to the
 * right RW entry point and wraps success/failure in the IPC response envelope.
 */

import { dispatchHostRpc } from '../host-rpc-dispatcher';
import { fileStorageManager } from '@/lib/file-storage/manager';
import { writeCharacterAvatarToVault } from '@/lib/file-storage/character-vault-bridge';
import { writeLanternBackgroundToMountStore } from '@/lib/file-storage/lantern-store-bridge';
import type { ChildHostRpcRequestMessage } from '../../ipc-types';

const mockUpload = jest.mocked(fileStorageManager.uploadFile);
const mockVault = jest.mocked(writeCharacterAvatarToVault);
const mockLantern = jest.mocked(writeLanternBackgroundToMountStore);

function req(
  method: ChildHostRpcRequestMessage['method'],
  ...args: unknown[]
): ChildHostRpcRequestMessage {
  return { type: 'host-rpc', requestId: 'req-1', method, args };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('dispatchHostRpc', () => {
  it('routes uploadFile to FileStorageManager.uploadFile', async () => {
    const params = {
      filename: 'a.png',
      content: Buffer.from('x'),
      contentType: 'image/png',
      projectId: 'p1',
    };

    const res = await dispatchHostRpc(req('uploadFile', params));

    expect(mockUpload).toHaveBeenCalledWith(params);
    expect(res).toMatchObject({
      type: 'host-rpc-response',
      requestId: 'req-1',
      ok: true,
    });
    expect(res.result).toEqual({ storageKey: 'mock-storage-key' });
  });

  it('routes writeCharacterAvatarToVault to the character-vault bridge', async () => {
    const params = {
      characterId: 'c1',
      kind: 'history',
      filename: 'av.webp',
      content: Buffer.from('x'),
      contentType: 'image/webp',
    };

    const res = await dispatchHostRpc(req('writeCharacterAvatarToVault', params));

    expect(mockVault).toHaveBeenCalledWith(params);
    expect(res.ok).toBe(true);
    expect(res.result).toMatchObject({
      linkId: 'mock-link-id',
      storageKey: 'mount-blob:mock-vault-mount:mock-blob-id',
    });
  });

  it('routes writeLanternBackgroundToMountStore to the lantern bridge', async () => {
    const params = {
      filename: 'bg.webp',
      content: Buffer.from('x'),
      contentType: 'image/webp',
      subfolder: 'generated',
    };

    const res = await dispatchHostRpc(req('writeLanternBackgroundToMountStore', params));

    expect(mockLantern).toHaveBeenCalledWith(params);
    expect(res.ok).toBe(true);
    expect(res.result).toMatchObject({
      storageKey: 'mount-blob:mock-lantern-mount:mock-blob-id',
    });
  });

  it('returns a failure envelope for an unknown method', async () => {
    const res = await dispatchHostRpc(req('bogus' as never));

    expect(res.ok).toBe(false);
    expect(res.error?.message).toContain('Unknown host-rpc method');
    expect(res.requestId).toBe('req-1');
  });

  it('wraps a thrown bridge error in a failure envelope, preserving the requestId', async () => {
    mockVault.mockRejectedValueOnce(new Error('vault exploded'));

    const res = await dispatchHostRpc(req('writeCharacterAvatarToVault', {}));

    expect(res.ok).toBe(false);
    expect(res.error?.message).toBe('vault exploded');
    expect(res.error?.stack).toBeDefined();
  });
});
