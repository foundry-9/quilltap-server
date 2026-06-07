/**
 * Path constants and the typed unavailability error for the project document
 * store overlay.
 *
 * This is the single source of truth for "which project field lives in which
 * store file." It has no dependencies on the other overlay submodules, so both
 * the read overlay and the write overlay can share it without cycles. Mirrors
 * `lib/database/repositories/vault-overlay/schema.ts` for characters.
 *
 * @module projects/project-store/schema
 */

/**
 * The relative paths of the overlay documents inside a project's official
 * document store. Mirrors `writeProjectStoreManagedFields()`.
 *
 * Path lookups are case-insensitive (the doc-store repository lowercases on
 * read), so `Description.md` resolves too — matching character vault behaviour.
 */
export const PROJECT_DESCRIPTION_MD_PATH = 'description.md';
export const PROJECT_INSTRUCTIONS_MD_PATH = 'instructions.md';
export const PROJECT_STATE_JSON_PATH = 'state.json';
export const PROJECT_PROPERTIES_JSON_PATH = 'properties.json';

/**
 * The four single-file overlay paths, in a stable order. The read overlay runs
 * one batched `findManyByMountPointsAndPath` query per entry.
 *
 * `properties.json` is the keystone: a provisioned store always has it. Its
 * absence (or an unparseable body), or a null/unreadable `officialMountPointId`,
 * is the hard-error trigger. `description.md` / `instructions.md` absent → null;
 * `state.json` absent → `{}` (all legitimate empty states).
 */
export const PROJECT_SINGLE_FILE_OVERLAY_PATHS = [
  PROJECT_PROPERTIES_JSON_PATH,
  PROJECT_DESCRIPTION_MD_PATH,
  PROJECT_INSTRUCTIONS_MD_PATH,
  PROJECT_STATE_JSON_PATH,
] as const;

/**
 * Thrown when a project has no usable official document store — a null/unreadable
 * `officialMountPointId`, or a missing/unparseable `properties.json`. This is a
 * broken invariant, not a routine state: a provisioned project always has a
 * populated store.
 *
 * The read overlay's single-fetch path (`applyProjectStoreOverlayOne`, behind
 * `findById`) throws this. The batched list path (`applyProjectStoreOverlay`,
 * behind `findAll`/`findByCharacterId`) catches it, logs at `error`, and drops
 * the offending project so one bad row cannot take down the whole project list.
 */
export class ProjectStoreUnavailableError extends Error {
  constructor(
    public readonly projectId: string,
    public readonly officialMountPointId: string | null | undefined,
    detail?: string,
  ) {
    super(
      `Project ${projectId} has no usable document store ` +
        `(officialMountPointId=${officialMountPointId ?? 'null'})` +
        (detail ? `: ${detail}` : ''),
    );
    this.name = 'ProjectStoreUnavailableError';
  }
}
