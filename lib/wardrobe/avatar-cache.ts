/**
 * Avatar configuration cache.
 *
 * One avatar per character *per configuration*. `buildCharacterAvatarPrompt` is
 * a pure function, so the prompt it returns is already the canonical
 * serialization of every deterministic input — the head-and-shoulders physical
 * variant, the expanded leaf outfit, the pronoun subject noun, the bare-top
 * crop branch, the capped art-direction preamble. There is nothing to hash
 * separately; the prompt *is* the digest.
 *
 * What the prompt does not carry is the provider-side shape — model, LoRAs,
 * stored profile options, size — which come from `buildImageGenParams` and
 * change the picture without changing a character of prompt text. So the key
 * covers the whole built params object as well.
 *
 * This module is the only place a key is derived or looked up. Never compute
 * one at a call site: a second derivation is a second format, and the two drift.
 *
 * Design of record: `docs/developer/features/avatar-configuration-cache.md`.
 *
 * @module wardrobe/avatar-cache
 */

import { createHash } from 'crypto';
import { logger } from '@/lib/logger';
import { mountBlobExists } from '@/lib/file-storage/project-store-bridge';
import type { FileEntry } from '@/lib/schemas/types';
import type { ImageGenParams } from '@quilltap/plugin-types';
import type { getRepositories } from '@/lib/repositories/factory';

/**
 * Inputs for a full-fidelity (v1) key. Taken from the **pre-reroute** profile:
 * the lookup runs before the Concierge classification call so a hit saves that
 * call too, which means a Concierge reroute stores its image under the
 * originally-requested key. That is correct — same inputs, same outcome — but
 * it does mean a cached row's `generationModel` need not match its key's model.
 */
export interface AvatarCacheKeyInput {
  /** Image provider id (`profile.provider`). */
  provider: string;
  /** Image profile id — two profiles on one model are two configurations. */
  imageProfileId: string;
  /** The full `buildImageGenParams` output, prompt included. */
  params: ImageGenParams;
}

/** Inputs for the lower-fidelity (v0) key carried by pre-cache rows. */
export interface LegacyAvatarCacheKeyInput {
  /** `files.generationModel` as recorded at generation time. */
  modelName: string | null | undefined;
  /** `files.generationPrompt` as recorded at generation time. */
  prompt: string;
}

/**
 * Stable JSON: object keys sorted recursively, so a reordered params object can
 * never produce a different hash. Arrays keep their order — a LoRA list is
 * ordered and two orderings are two configurations.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    // `undefined` and a missing key mean the same thing to a provider, so they
    // must hash the same way.
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Full-fidelity key for a configuration. `v: 1` is the format discriminator —
 * it is what keeps a v1 key from ever colliding with a legacy v0 key.
 */
export function deriveAvatarCacheKey(input: AvatarCacheKeyInput): string {
  return sha256Hex(
    canonicalJson({
      v: 1,
      provider: input.provider,
      imageProfileId: input.imageProfileId,
      params: input.params,
    }),
  );
}

/**
 * Lower-fidelity key for rows that predate the cache. Their LoRAs and stored
 * options are not recorded anywhere, so only the prompt and model can be
 * reconstructed — which is exactly what `collapse-duplicate-avatar-rolls-v1`
 * groups on.
 */
export function deriveLegacyAvatarCacheKey(input: LegacyAvatarCacheKeyInput): string {
  return sha256Hex(
    canonicalJson({
      v: 0,
      modelName: input.modelName ?? null,
      prompt: input.prompt,
    }),
  );
}

/** Both keys for one generation, in lookup order. */
export interface AvatarCacheKeys {
  /** Full-fidelity key; what a new row is stored under. */
  key: string;
  /** Legacy key, matching rows the migration keyed. */
  legacyKey: string;
}

/**
 * Derive both keys for a generation about to happen.
 */
export function deriveAvatarCacheKeys(input: AvatarCacheKeyInput): AvatarCacheKeys {
  return {
    key: deriveAvatarCacheKey(input),
    legacyKey: deriveLegacyAvatarCacheKey({
      modelName: input.params.model ?? null,
      prompt: input.params.prompt,
    }),
  };
}

/**
 * Look up a cached avatar for a configuration.
 *
 * Tries the full-fidelity key first, then the legacy key. A v0 hit is
 * deliberately **not** upgraded to a v1 key: we cannot verify that the LoRAs
 * and options in force back then match the ones in force now, and a second
 * indexed read costs nothing.
 *
 * A row whose blob has since been deleted counts as a miss. `deleteMountBlob`
 * drops every link to a blob's file, and a cache means many chats point at one
 * file id, so this check is what keeps one deletion from wedging every chat
 * that shared the image: the caller regenerates and rebinds the key.
 *
 * @returns the cached file, or null when the configuration has no usable image.
 */
export async function lookupCachedAvatar(
  repos: ReturnType<typeof getRepositories>,
  keys: AvatarCacheKeys,
  characterId: string,
): Promise<FileEntry | null> {
  for (const candidateKey of [keys.key, keys.legacyKey]) {
    let rows: FileEntry[];
    try {
      rows = await repos.files.findByGenerationKey(candidateKey);
    } catch (error) {
      // A cache lookup must never be the reason an avatar fails to generate.
      logger.warn('[AvatarCache] Lookup failed, treating as a miss', {
        context: 'wardrobe.avatar-cache',
        characterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    // Newest first — a forced reroll rebinds the key, and the newest holder is
    // the one that won it.
    const ordered = [...rows].sort((a, b) =>
      String(b.createdAt).localeCompare(String(a.createdAt)),
    );

    for (const row of ordered) {
      // Belt and braces: a key encodes the character's name and description, so
      // a cross-character hit should be impossible. Confirm anyway rather than
      // hand one character another's face.
      if (!row.tags?.includes(characterId)) {
        continue;
      }
      if (!row.storageKey) {
        continue;
      }
      if (!(await mountBlobExists(row.storageKey))) {
        logger.info('[AvatarCache] Cached avatar blob is gone, regenerating', {
          context: 'wardrobe.avatar-cache',
          characterId,
          fileId: row.id,
        });
        continue;
      }

      logger.debug('[AvatarCache] Hit', {
        context: 'wardrobe.avatar-cache',
        characterId,
        fileId: row.id,
        legacy: candidateKey === keys.legacyKey,
      });
      return row;
    }
  }

  logger.debug('[AvatarCache] Miss', {
    context: 'wardrobe.avatar-cache',
    characterId,
  });
  return null;
}
