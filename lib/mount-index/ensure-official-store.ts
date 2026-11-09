/**
 * Official Document-Store Lifecycle — server-only, shared core.
 *
 * Single implementation of the "find / adopt / create" flow that provisions an
 * entity's canonical "official" document store and persists the FK on the
 * entity row. `ensure-owner-store.ts` builds an {@link EnsureOfficialStoreConfig}
 * per owner kind (project, group) and `character-vault.ts` builds one for a
 * character's vault; they differ in naming, store shape, how they adopt (by
 * link for owners, by name for vaults) and what a fresh store is seeded with.
 *
 * Imports the repository factory (for `findAll` / `create`), which transitively
 * pulls in node-only modules. Kept separate from the `*-store-naming.ts`
 * pure-function modules so those remain client-safe.
 *
 * @module mount-index/ensure-official-store
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { nextUniqueMountPointName } from './unique-mount-point-name';

/** Minimal shape of the raw entity row this flow needs. */
export interface OfficialStoreEntityRow {
  officialMountPointId?: string | null;
}

/** A store a flow may adopt instead of creating one. */
export interface AdoptableStore {
  id: string;
  name: string;
}

/**
 * Per-entity wiring for {@link ensureOfficialStore}. Everything that differs
 * between the owners — projects, groups, character vaults — is expressed here;
 * the resolution order, the create payload, and logging are owned by the core.
 */
export interface EnsureOfficialStoreConfig {
  /** Lowercase entity noun used in log messages, e.g. `'project'` / `'character'`. */
  entityLabel: string;
  /** Capitalised entity noun used in log messages, e.g. `'Project'` / `'Character'`. */
  entityLabelCapitalized: string;
  /** Log-context key for the entity id, e.g. `'projectId'` / `'characterId'`. */
  entityIdLogKey: string;
  /** The name a fresh store is given (before collision suffixing). */
  storeNameFor(entityName: string): string;
  /** `storeType` and `includePatterns` of a fresh store. */
  storeShape: { storeType: 'documents' | 'character'; includePatterns: string[] };
  /** Read the RAW entity row (never the overlay-applied read). */
  findEntityRaw(entityId: string): Promise<OfficialStoreEntityRow | null>;
  /**
   * When the row's pointer names a mount point that does not exist: `'heal'`
   * provisions a fresh store (projects, groups); `'trust'` returns the pointer
   * as it is (character vaults — a mount-index read can miss mid cloud
   * materialisation, and re-pointing a character away from its real vault on
   * a transient miss would orphan it).
   */
  stalePointer: 'heal' | 'trust';
  /** A store to adopt before creating one, or null. */
  findAdoptable(entityId: string, entityName: string): Promise<AdoptableStore | null>;
  /** FK write — must not re-read the store overlay; may verify the write stuck. */
  setOfficialMountPointId(entityId: string, mountPointId: string): Promise<void>;
  /** Link a freshly created store to the entity, where the owner keeps link rows. */
  link?(entityId: string, mountPointId: string): Promise<unknown>;
  /** Populate a freshly created store's structure (a character vault's scaffold). */
  afterCreate?(mountPointId: string): Promise<unknown>;
}

/**
 * The project / group adoption rule: an existing link to a database-backed
 * `documents` store, preferring one that carries the owner's own-store name.
 */
export async function findAdoptableLinkedStore(
  links: Array<{ mountPointId: string }>,
  isOwnStoreName: (name: string) => boolean,
): Promise<AdoptableStore | null> {
  if (links.length === 0) return null;
  const repos = getRepositories();
  const linkedStores = await Promise.all(links.map(l => repos.docMountPoints.findById(l.mountPointId)));
  const eligible = linkedStores.filter(
    (s): s is NonNullable<typeof s> =>
      !!s && s.mountType === 'database' && (s.storeType ?? 'documents') === 'documents',
  );
  const adoptable = eligible.find(s => isOwnStoreName(s.name)) ?? eligible[0] ?? null;
  return adoptable ? { id: adoptable.id, name: adoptable.name } : null;
}

/**
 * Find or create the entity's canonical "official" document store and return
 * its mount-point ID. Idempotent.
 *
 * Resolution order:
 *   1. If `entity.officialMountPointId` is set and the mount point still
 *      exists, return it.
 *   2. If a link exists to a database-backed `documents` store (preferring a
 *      name-prefix match), adopt it: write its ID to the entity FK and return.
 *   3. Otherwise create a fresh `<prefix><name>` mount point (using
 *      `nextUniqueMountPointName` for collision handling), insert the link,
 *      write the ID to the entity FK, and return it.
 *
 * Returns `{ mountPointId, created }` where `created` is true when this call
 * created a new mount point (vs. adopting/finding an existing one).
 */
export async function ensureOfficialStore(
  config: EnsureOfficialStoreConfig,
  entityId: string,
  entityName: string,
): Promise<{ mountPointId: string; created: boolean; adopted?: boolean } | null> {
  const repos = getRepositories();

  // Read the RAW row, never the overlay-applied `findById`. Provisioning runs
  // BEFORE the store files exist (entity creation, startup backfill, and the
  // cutover migration all call this), so the store-only overlay would throw
  // a `*StoreUnavailableError` (missing properties.json) or, mid-migration,
  // the schema-validating read can reject a legacy wide row. We only need the
  // entity's existence, name, and `officialMountPointId` — all raw-row fields.
  const entity = await config.findEntityRaw(entityId);
  if (!entity) {
    logger.warn(`ensure${config.entityLabelCapitalized}OfficialStore: ${config.entityLabel} not found`, {
      [config.entityIdLogKey]: entityId,
    });
    return null;
  }

  // 1. Existing FK still valid?
  if (entity.officialMountPointId) {
    if (config.stalePointer === 'trust') {
      return { mountPointId: entity.officialMountPointId, created: false };
    }
    const existing = await repos.docMountPoints.findById(entity.officialMountPointId);
    if (existing) {
      return { mountPointId: existing.id, created: false };
    }
    logger.info(`${config.entityLabelCapitalized} officialMountPointId points to a missing mount point; will heal`, {
      [config.entityIdLogKey]: entityId,
      staleMountPointId: entity.officialMountPointId,
    });
  }

  // 2. Adopt an existing store if the owner's rule finds one.
  const adoptable = await config.findAdoptable(entityId, entityName);
  if (adoptable) {
    // FK write that must not re-read the store overlay: on the create path the
    // adopted store may have no properties.json yet. See setOfficialMountPointId.
    await config.setOfficialMountPointId(entityId, adoptable.id);
    logger.info(`Adopted an existing store as ${config.entityLabel} official`, {
      [config.entityIdLogKey]: entityId,
      mountPointId: adoptable.id,
      storeName: adoptable.name,
    });
    return { mountPointId: adoptable.id, created: false, adopted: true };
  }

  // 3. Create a fresh store and link it.
  const desiredName = config.storeNameFor((entityName || 'Untitled').trim()).slice(0, 200);
  const all = await repos.docMountPoints.findAll();
  const taken = new Set(all.map(mp => mp.name));
  const finalName = nextUniqueMountPointName(taken, desiredName);

  const mountPoint = await repos.docMountPoints.create({
    name: finalName,
    basePath: '',
    mountType: 'database',
    storeType: config.storeShape.storeType,
    includePatterns: config.storeShape.includePatterns,
    excludePatterns: ['.git', 'node_modules', '.obsidian', '.trash'],
    enabled: true,
    lastScannedAt: null,
    scanStatus: 'idle',
    lastScanError: null,
    conversionStatus: 'idle',
    conversionError: null,
    fileCount: 0,
    chunkCount: 0,
    totalSizeBytes: 0,
  });

  await config.afterCreate?.(mountPoint.id);
  await config.link?.(entityId, mountPoint.id);
  // Raw FK write — `create()` populates the store files (properties.json et al.)
  // only AFTER this returns, so the overlay-applying `update()` would throw
  // *StoreUnavailableError on its closing re-read. See setOfficialMountPointId.
  await config.setOfficialMountPointId(entityId, mountPoint.id);

  logger.info(`Created ${config.entityLabel}-official document store`, {
    [config.entityIdLogKey]: entityId,
    mountPointId: mountPoint.id,
    storeName: finalName,
  });

  return { mountPointId: mountPoint.id, created: true };
}
