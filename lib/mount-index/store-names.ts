/**
 * Document-store naming rules.
 *
 * Store names form one case-insensitive namespace: a store is addressed by
 * name in `qtap://` URIs and in every doc tool, so two stores sharing a name
 * make that name ambiguous. On top of that namespace sit two naming rules for
 * character vaults:
 *
 *  - The vault a character points at is named after that character:
 *    `"<Name> Character Vault"`. Two live characters sharing a name cannot
 *    both hold it, so the later one takes the standard ` (N)` suffix.
 *  - A vault no character points at any more (an earlier vault left behind
 *    by a restore, a re-provision, or a deleted character) is retired to
 *    `"<Name> Version <timestamp> Store"`, freeing the plain name for the live
 *    vault. Only a store still carrying a vault-shaped name is retired; one
 *    the operator has renamed to something of their own is left alone.
 *
 * {@link planStoreNames} turns those rules into a rename list. It is pure, so
 * the boot reconcile, the restore and the tests all share one answer.
 *
 * @module mount-index/store-names
 */

import { nextUniqueMountPointName } from './unique-mount-point-name';

/** The name a character's live vault carries. */
export function characterVaultName(characterName: string): string {
  return `${(characterName || 'Untitled').trim()} Character Vault`;
}

// Any number of ` (N)` suffixes: a restore that meets a taken "… (2)" adds a
// second one.
const VAULT_NAME_PATTERN = /^(.*\S)\s+Character Vault(?:\s+\(\d+\))*$/i;

/**
 * The character name a vault-shaped store name was built from
 * (`"Tester Character Vault (2)"` → `"Tester"`), or null when the name is not
 * vault-shaped. Trailing ` (N)` suffixes are ignored.
 */
export function vaultBaseName(storeName: string): string | null {
  const match = VAULT_NAME_PATTERN.exec(storeName.trim());
  return match ? match[1] : null;
}

/**
 * A compact UTC stamp with no colons, so the name reads cleanly in a
 * `qtap://` authority: `2026-10-09T16:45:06.123Z` → `2026-10-09T164506Z`.
 */
export function storeNameTimestamp(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso.replace(/:/g, '');
  const d = new Date(ms).toISOString(); // YYYY-MM-DDTHH:MM:SS.sssZ
  return `${d.slice(0, 10)}T${d.slice(11, 13)}${d.slice(14, 16)}${d.slice(17, 19)}Z`;
}

/** The name a vault takes once no character points at it. */
export function retiredVaultName(baseName: string, createdAt: string): string {
  return `${baseName.trim()} Version ${storeNameTimestamp(createdAt)} Store`;
}

/** Just enough of a store row to name it. */
export interface StoreNameRow {
  id: string;
  name: string;
  storeType?: string | null;
  createdAt: string;
}

/** Just enough of a character row to name its vault. */
export interface VaultOwnerRow {
  id: string;
  name: string;
  characterDocumentMountPointId?: string | null;
  createdAt: string;
}

export interface StoreRename {
  id: string;
  from: string;
  to: string;
  reason: 'live-vault' | 'retired-vault' | 'collision';
}

const lower = (name: string): string => name.trim().toLowerCase();

const byAge = <T extends { createdAt: string; id: string }>(a: T, b: T): number =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/**
 * Decide every store's name under the rules above and return the renames
 * needed to get there (empty when the instance already conforms).
 *
 * Order of claim on the namespace:
 *  1. Live vaults, each to its character's vault name. One that already holds
 *     its exact name keeps it; then the older character wins. Each further
 *     namesake takes the lowest free ` (N)`, so the names stay predictable.
 *  2. Every other store, oldest first, keeps its name if it is still free,
 *     otherwise takes the next ` (N)` (the case-insensitive collision repair).
 *     An unlinked vault with a vault-shaped name is retired first — unless a
 *     character with no vault bears that name, since `ensureCharacterVault`
 *     may yet adopt it.
 */
export function planStoreNames(
  stores: ReadonlyArray<StoreNameRow>,
  characters: ReadonlyArray<VaultOwnerRow>,
): StoreRename[] {
  const storeIds = new Set(stores.map((s) => s.id));

  // Store id → its owner (the oldest character pointing at it, should a
  // damaged instance have two).
  const ownerByStore = new Map<string, VaultOwnerRow>();
  // Vault names a character without a vault could still adopt.
  const adoptableNames = new Set<string>();
  for (const character of [...characters].sort(byAge)) {
    const pointer = character.characterDocumentMountPointId;
    if (pointer && storeIds.has(pointer)) {
      if (!ownerByStore.has(pointer)) ownerByStore.set(pointer, character);
    } else {
      adoptableNames.add(lower(characterVaultName(character.name)));
    }
  }

  const taken = new Set<string>();
  const finalName = new Map<string, { name: string; reason: StoreRename['reason'] }>();
  const claim = (store: StoreNameRow, name: string, reason: StoreRename['reason']): void => {
    taken.add(lower(name));
    finalName.set(store.id, { name, reason });
  };

  // 1. Live vaults.
  const liveVaults = stores.filter((s) => ownerByStore.has(s.id));
  const holdsCanonical = (s: StoreNameRow): boolean =>
    lower(s.name) === lower(characterVaultName(ownerByStore.get(s.id)!.name));
  liveVaults.sort((a, b) => {
    const held = Number(holdsCanonical(b)) - Number(holdsCanonical(a));
    if (held !== 0) return held;
    return byAge(ownerByStore.get(a.id)!, ownerByStore.get(b.id)!) || byAge(a, b);
  });
  for (const store of liveVaults) {
    const canonical = characterVaultName(ownerByStore.get(store.id)!.name);
    claim(store, nextUniqueMountPointName(taken, canonical), 'live-vault');
  }

  // 2. Everything else, oldest first.
  for (const store of stores.filter((s) => !ownerByStore.has(s.id)).sort(byAge)) {
    const base = store.storeType === 'character' ? vaultBaseName(store.name) : null;
    if (base !== null && !adoptableNames.has(lower(characterVaultName(base)))) {
      claim(store, nextUniqueMountPointName(taken, retiredVaultName(base, store.createdAt)), 'retired-vault');
      continue;
    }
    const name = taken.has(lower(store.name)) ? nextUniqueMountPointName(taken, store.name.trim()) : store.name;
    claim(store, name, 'collision');
  }

  const renames: StoreRename[] = [];
  for (const store of stores) {
    const decided = finalName.get(store.id)!;
    if (decided.name !== store.name) {
      renames.push({ id: store.id, from: store.name, to: decided.name, reason: decided.reason });
    }
  }
  return renames;
}
