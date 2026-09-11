/**
 * Unit tests for the avatar configuration cache.
 *
 * The key is the whole feature: get it wrong in either direction and you
 * either redraw a portrait that already exists, or hand a character someone
 * else's face. The lookup's job is narrower — never return something the
 * caller cannot actually render.
 */

import {
  deriveAvatarCacheKey,
  deriveAvatarCacheKeys,
  deriveLegacyAvatarCacheKey,
  lookupCachedAvatar,
} from '../avatar-cache';
import type { ImageGenParams } from '@quilltap/plugin-types';

jest.mock('@/lib/file-storage/project-store-bridge', () => ({
  mountBlobExists: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { mountBlobExists } from '@/lib/file-storage/project-store-bridge';

const mockMountBlobExists = mountBlobExists as jest.MockedFunction<typeof mountBlobExists>;

function params(overrides: Partial<ImageGenParams> = {}): ImageGenParams {
  return {
    prompt: 'Solo portrait of a single woman: Friday. Character portrait, detailed.',
    model: 'flux-dev',
    n: 1,
    ...overrides,
  } as ImageGenParams;
}

function input(overrides: Partial<Parameters<typeof deriveAvatarCacheKey>[0]> = {}) {
  return {
    provider: 'replicate',
    imageProfileId: 'profile-1',
    params: params(),
    ...overrides,
  };
}

function fileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-1',
    tags: ['char-1'],
    storageKey: 'mount-blob:mount-1:blob-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as never;
}

function reposWith(byKey: Record<string, unknown[]>) {
  return {
    files: {
      findByGenerationKey: jest.fn(async (key: string) => byKey[key] ?? []),
    },
  } as never;
}

describe('deriveAvatarCacheKey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('is stable across calls with identical input', () => {
    expect(deriveAvatarCacheKey(input())).toBe(deriveAvatarCacheKey(input()));
  });

  it('ignores key ordering inside the params object', () => {
    const a = deriveAvatarCacheKey(input({ params: { prompt: 'p', model: 'm', n: 1 } as ImageGenParams }));
    const b = deriveAvatarCacheKey(input({ params: { n: 1, model: 'm', prompt: 'p' } as ImageGenParams }));
    expect(a).toBe(b);
  });

  it('treats an explicit undefined the same as an absent field', () => {
    const a = deriveAvatarCacheKey(input({ params: { prompt: 'p', model: 'm' } as ImageGenParams }));
    const b = deriveAvatarCacheKey(
      input({ params: { prompt: 'p', model: 'm', size: undefined } as ImageGenParams }),
    );
    expect(a).toBe(b);
  });

  it('changes when the prompt changes', () => {
    expect(deriveAvatarCacheKey(input())).not.toBe(
      deriveAvatarCacheKey(input({ params: params({ prompt: 'a different outfit' }) })),
    );
  });

  it('changes when the model changes', () => {
    expect(deriveAvatarCacheKey(input())).not.toBe(
      deriveAvatarCacheKey(input({ params: params({ model: 'sdxl' }) })),
    );
  });

  it('changes when the profile changes, even on the same model', () => {
    // Two profiles on one model are two configurations: their LoRAs and stored
    // options differ without changing a character of prompt text.
    expect(deriveAvatarCacheKey(input())).not.toBe(
      deriveAvatarCacheKey(input({ imageProfileId: 'profile-2' })),
    );
  });

  it('distinguishes LoRA order — an ordered list is part of the configuration', () => {
    const withLoras = (sources: string[]) =>
      deriveAvatarCacheKey(
        input({ params: params({ loras: sources.map((source) => ({ source })) }) }),
      );
    expect(withLoras(['a', 'b'])).not.toBe(withLoras(['b', 'a']));
  });
});

describe('deriveLegacyAvatarCacheKey', () => {
  it('never collides with a full-fidelity key over the same prompt and model', () => {
    // The `v` discriminator is what guarantees this: a v0 row keyed by the
    // migration must not answer a v1 lookup by accident.
    const legacy = deriveLegacyAvatarCacheKey({ modelName: 'flux-dev', prompt: params().prompt });
    const full = deriveAvatarCacheKey(input());
    expect(legacy).not.toBe(full);
  });

  it('treats a null model and a missing model identically', () => {
    expect(deriveLegacyAvatarCacheKey({ modelName: null, prompt: 'p' })).toBe(
      deriveLegacyAvatarCacheKey({ modelName: undefined, prompt: 'p' }),
    );
  });

  it('is what deriveAvatarCacheKeys pairs with the full key', () => {
    const keys = deriveAvatarCacheKeys(input());
    expect(keys.legacyKey).toBe(
      deriveLegacyAvatarCacheKey({ modelName: 'flux-dev', prompt: params().prompt }),
    );
    expect(keys.key).toBe(deriveAvatarCacheKey(input()));
  });
});

describe('lookupCachedAvatar', () => {
  const keys = { key: 'K1', legacyKey: 'K0' };

  beforeEach(() => {
    jest.clearAllMocks();
    mockMountBlobExists.mockResolvedValue(true);
  });

  it('returns the row matching the full-fidelity key', async () => {
    const repos = reposWith({ K1: [fileRow()] });
    const hit = await lookupCachedAvatar(repos, keys, 'char-1');
    expect(hit?.id).toBe('file-1');
  });

  it('falls back to the legacy key when the full key misses', async () => {
    const repos = reposWith({ K0: [fileRow({ id: 'legacy-file' })] });
    const hit = await lookupCachedAvatar(repos, keys, 'char-1');
    expect(hit?.id).toBe('legacy-file');
  });

  it('prefers the newest holder of a key — a reroll rebinds it', async () => {
    const repos = reposWith({
      K1: [
        fileRow({ id: 'older', createdAt: '2026-01-01T00:00:00.000Z' }),
        fileRow({ id: 'newer', createdAt: '2026-06-01T00:00:00.000Z' }),
      ],
    });
    const hit = await lookupCachedAvatar(repos, keys, 'char-1');
    expect(hit?.id).toBe('newer');
  });

  it('treats a row whose blob is gone as a miss', async () => {
    // deleteMountBlob drops every link to a blob's file, and many chats can
    // share one cached file — this check is what keeps one deletion from
    // wedging all of them.
    mockMountBlobExists.mockResolvedValue(false);
    const repos = reposWith({ K1: [fileRow()] });
    expect(await lookupCachedAvatar(repos, keys, 'char-1')).toBeNull();
  });

  it('skips a row whose blob is gone and returns the next usable one', async () => {
    mockMountBlobExists.mockImplementation(async (storageKey: string) =>
      storageKey === 'mount-blob:mount-1:good',
    );
    const repos = reposWith({
      K1: [
        fileRow({ id: 'dead', createdAt: '2026-06-01T00:00:00.000Z', storageKey: 'mount-blob:mount-1:gone' }),
        fileRow({ id: 'alive', createdAt: '2026-01-01T00:00:00.000Z', storageKey: 'mount-blob:mount-1:good' }),
      ],
    });
    const hit = await lookupCachedAvatar(repos, keys, 'char-1');
    expect(hit?.id).toBe('alive');
  });

  it('never hands one character another character\'s face', async () => {
    const repos = reposWith({ K1: [fileRow({ tags: ['someone-else'] })] });
    expect(await lookupCachedAvatar(repos, keys, 'char-1')).toBeNull();
  });

  it('skips a row with no storageKey', async () => {
    const repos = reposWith({ K1: [fileRow({ storageKey: null })] });
    expect(await lookupCachedAvatar(repos, keys, 'char-1')).toBeNull();
  });

  it('returns null rather than throwing when the read fails', async () => {
    // A cache lookup must never be the reason an avatar fails to generate.
    const repos = {
      files: {
        findByGenerationKey: jest.fn(async () => {
          throw new Error('database is locked');
        }),
      },
    } as never;
    expect(await lookupCachedAvatar(repos, keys, 'char-1')).toBeNull();
  });

  it('returns null when nothing matches either key', async () => {
    const repos = reposWith({});
    expect(await lookupCachedAvatar(repos, keys, 'char-1')).toBeNull();
  });
});
