/**
 * Bring every document store's name into line with the naming rules in
 * `store-names.ts`: one case-insensitive namespace, each live character vault
 * named after its character, and every vault no character points at retired to
 * `"<Name> Version <timestamp> Store"`.
 *
 * Runs at boot (after the character-vault backfill, so a vault awaiting
 * adoption is adopted first), at the end of a backup restore and a `.qtap`
 * import, and whenever a character is renamed or deleted. A no-op when the
 * instance already conforms: two reads and a pure plan.
 *
 * Parent-process only. The renames are applied in one transaction on the
 * mount-index database, in two phases (every renamed row to a placeholder,
 * then to its final name) so a swap of names can never trip the unique name
 * index halfway through. In the job child — whose database is read-only — it
 * does nothing; the parent's next pass picks up whatever the child changed.
 *
 * @module mount-index/reconcile-store-names
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { getRawMountIndexDatabase, isMountIndexDegraded } from '@/lib/database/backends/sqlite/mount-index-client';
import { publishRealtime } from '@/lib/realtime/bus';
import { planStoreNames, type StoreRename } from './store-names';

const log = logger.child({ module: 'mount-index:reconcile-store-names' });

export interface StoreNameReconcileResult {
  renamed: StoreRename[];
  skippedReason: 'job-child' | 'mount-index-unavailable' | null;
}

export async function reconcileStoreNames(trigger: string): Promise<StoreNameReconcileResult> {
  if (process.env.QUILLTAP_JOB_CHILD === '1') {
    log.debug('Store-name reconcile skipped in the job child', { trigger });
    return { renamed: [], skippedReason: 'job-child' };
  }
  const db = isMountIndexDegraded() ? null : getRawMountIndexDatabase();
  if (!db) {
    log.warn('Store-name reconcile skipped: mount-index database unavailable', { trigger });
    return { renamed: [], skippedReason: 'mount-index-unavailable' };
  }

  const repos = getRepositories();
  const [stores, characters] = await Promise.all([
    repos.docMountPoints.findAll(),
    repos.characters.findAllRaw(),
  ]);
  const renames = planStoreNames(stores, characters);
  log.debug('Store-name reconcile planned', {
    trigger,
    storeCount: stores.length,
    characterCount: characters.length,
    renameCount: renames.length,
  });
  if (renames.length === 0) return { renamed: [], skippedReason: null };

  const now = new Date().toISOString();
  const setName = db.prepare('UPDATE "doc_mount_points" SET "name" = ?, "updatedAt" = ? WHERE "id" = ?');
  db.transaction(() => {
    for (const rename of renames) setName.run(`__renaming__ ${rename.id}`, now, rename.id);
    for (const rename of renames) setName.run(rename.to, now, rename.id);
  })();

  for (const rename of renames) {
    log.info('Renamed document store to its rightful name', { trigger, ...rename });
  }
  publishRealtime('mountPoints');
  return { renamed: renames, skippedReason: null };
}
