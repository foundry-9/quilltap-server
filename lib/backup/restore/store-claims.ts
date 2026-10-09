/**
 * Which archived store each restored entity is bound to (bug 185).
 *
 * A character's vault and a project's or group's official store travel in the
 * archive beside the entity row, and the restore brings both back. The
 * entities' ordinary create paths always mint a fresh store, which is right for
 * a new entity and wrong here: the row ends up pointing at an empty store and
 * the archive's own sits beside it, unreferenced. So the restore asks this
 * claim map first. When an entity's archived pointer names a store the archive
 * carries, the entity keeps that pointer and nothing is minted; otherwise it
 * falls through to the create path.
 *
 * The first entity to claim a store keeps it. A later claimant falls back to a
 * fresh store with a warning, so a damaged archive can never cross-link two
 * entities. A character may not claim a store recorded as anything but a
 * vault, nor a project or group a vault, for the same reason.
 *
 * The pointer and the carried ids must be in the same id space: in
 * `new-account` mode both have been through the restore's UUID remap, which
 * maps each original id to one new id wherever it appears.
 *
 * @module backup/restore/store-claims
 */

/** The entity kinds that own a store. */
export type StoreOwnerKind = 'character' | 'project' | 'group';

/** Just enough of a mount-point row to decide a claim. */
export interface CarriedStore {
  id: string;
  storeType?: string | null;
}

export type StoreClaim =
  | { bound: true; mountPointId: string }
  | {
      bound: false;
      /**
       * Why the entity falls back to a fresh store:
       *  - `no-pointer` — the archive gave it none
       *  - `not-carried` — the archive does not carry the store it names
       *  - `wrong-kind` — the store is the wrong kind for this entity
       *  - `already-claimed` — an earlier entity in the archive holds it
       */
      reason: 'no-pointer' | 'not-carried' | 'wrong-kind' | 'already-claimed';
      /** The entity that holds the store, for `already-claimed`. */
      claimedBy?: { kind: StoreOwnerKind; id: string };
    };

export interface StoreClaimMap {
  claim(kind: StoreOwnerKind, entityId: string, pointer: string | null | undefined): StoreClaim;
}

/**
 * Refuses only a positive mismatch: an archive from before `storeType` was
 * recorded carries none, and its stores are still the entities' own.
 */
function kindFits(kind: StoreOwnerKind, storeType: string | null | undefined): boolean {
  if (!storeType) return true;
  return kind === 'character' ? storeType === 'character' : storeType !== 'character';
}

/** Build the claim map for one restore from the stores the archive carries. */
export function makeStoreClaimMap(carriedStores: ReadonlyArray<CarriedStore>): StoreClaimMap {
  const carried = new Map<string, CarriedStore>(carriedStores.map((store) => [store.id, store]));
  const holders = new Map<string, { kind: StoreOwnerKind; id: string }>();

  return {
    claim(kind, entityId, pointer) {
      if (!pointer) return { bound: false, reason: 'no-pointer' };
      const store = carried.get(pointer);
      if (!store) return { bound: false, reason: 'not-carried' };
      if (!kindFits(kind, store.storeType)) return { bound: false, reason: 'wrong-kind' };
      const holder = holders.get(pointer);
      if (holder) return { bound: false, reason: 'already-claimed', claimedBy: holder };
      holders.set(pointer, { kind, id: entityId });
      return { bound: true, mountPointId: pointer };
    },
  };
}
