/**
 * The archived-character guard. An archived character is a tombstone whose
 * pruned vault is still live and writable, so this is what keeps it from being
 * edited back into existence: exactly one patch is sanctioned — unarchive.
 *
 * @module characters/archive-guard
 */

import type { Character, CharacterRow } from '@/lib/schemas/character.types';

export class CharacterArchivedError extends Error {
  constructor(characterId: string, message = 'this character is archived; rehydrate it to continue') {
    super(message);
    this.name = 'CharacterArchivedError';
    this.message = `Character ${characterId} is archived: ${message}`;
  }
}

/**
 * Guard every write to an archived character.
 *
 * Archiving prunes the vault in place (§4.2a): an archived character keeps a
 * live, writable vault, and this guard — running before the write overlay — is
 * what stands between that vault and an edit arriving through the repository.
 *
 * A tombstone is read-only with exactly one exception: **unarchive**, the
 * single-key patch that clears `archivedAt`. Nothing else is sanctioned — in
 * particular, nulling `characterDocumentMountPointId` (the old
 * archive-finalization patch) is refused, because nothing legitimately nulls
 * the pointer any more: the vault survives the archive.
 */
export function validateCharacterArchivePatch(existing: Partial<CharacterRow> | null, data: Partial<Character>): void {
  if (!existing?.archivedAt) {
    return;
  }

  const keys = Object.keys(data);

  const isSanctionedUnarchive = keys.length === 1 && 'archivedAt' in data && data.archivedAt === null;
  if (isSanctionedUnarchive) {
    return;
  }

  throw new CharacterArchivedError(existing.id ?? 'unknown');
}

