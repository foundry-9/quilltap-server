/**
 * The character vault as a store-backed repository binding — what
 * `CharactersRepository` hands `AbstractStoreBackedRepository` (D3 of
 * refactor-character-repository-and-vault.md). Produced here, by the vault
 * module, so the repository holds no copy of the overlay, the write routing or
 * the provisioning.
 *
 * @module characters/vault/binding
 */

import type { Character, CharacterRow } from '@/lib/schemas/character.types';
import { CharacterSchema } from '@/lib/schemas/character.types';
import type { StoreOverlayBinding } from '@/lib/database/repositories/store-backed.repository';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';
import { MANAGED_FIELDS } from './layout';
import { applyDocumentStoreOverlay, applyDocumentStoreOverlayOne } from './hydrate';
import { applyDocumentStoreWriteOverlay, writeCharacterVaultManagedFields } from './write';

export const characterVaultBinding: StoreOverlayBinding<CharacterRow, Character> = {
  managedFields: MANAGED_FIELDS,
  entityLabel: 'Character',
  idLogKey: 'characterId',
  applyOverlay: applyDocumentStoreOverlay,
  applyOverlayOne: applyDocumentStoreOverlayOne,
  applyWriteOverlay: applyDocumentStoreWriteOverlay,
  // The whole-character projection, from an in-memory character: a fresh
  // create, or a restore whose archived vault failed to arrive. Never a raw row.
  writeManagedFields: async (mountPointId, character) => {
    await writeCharacterVaultManagedFields(mountPointId, { character });
  },
  // A new character never adopts a same-name vault: it is new.
  ensureOfficialStore: (character) => ensureCharacterVault(character, { adopt: false }),
  // The row schema keeps only the columns; the content came in the payload.
  toEntity: (payload, row) => CharacterSchema.parse({ ...payload, ...row }),
};
