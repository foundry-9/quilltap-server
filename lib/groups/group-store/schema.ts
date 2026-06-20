/**
 * Path constants and the typed unavailability error for the group document
 * store overlay.
 *
 * This is the single source of truth for "which group field lives in which
 * store file." It has no dependencies on the other overlay submodules, so both
 * the read overlay and the write overlay can share it without cycles. Mirrors
 * `lib/database/repositories/vault-overlay/schema.ts` for characters.
 *
 * @module groups/group-store/schema
 */

/**
 * The relative paths of the overlay documents inside a group's official
 * document store. Mirrors `writeGroupStoreManagedFields()`.
 *
 * Path lookups are case-insensitive (the doc-store repository lowercases on
 * read), so `Description.md` resolves too — matching character vault behaviour.
 */
export const GROUP_DESCRIPTION_MD_PATH = 'description.md';
export const GROUP_INSTRUCTIONS_MD_PATH = 'instructions.md';
export const GROUP_STATE_JSON_PATH = 'state.json';
export const GROUP_PROPERTIES_JSON_PATH = 'properties.json';

/**
 * The four single-file overlay paths, in a stable order. The read overlay runs
 * one batched `findManyByMountPointsAndPath` query per entry.
 *
 * `properties.json` is the keystone: a provisioned store always has it. Its
 * absence (or an unparseable body), or a null/unreadable `officialMountPointId`,
 * is the hard-error trigger. `description.md` / `instructions.md` absent → null;
 * `state.json` absent → `{}` (all legitimate empty states).
 */
export const GROUP_SINGLE_FILE_OVERLAY_PATHS = [
  GROUP_PROPERTIES_JSON_PATH,
  GROUP_DESCRIPTION_MD_PATH,
  GROUP_INSTRUCTIONS_MD_PATH,
  GROUP_STATE_JSON_PATH,
] as const;

/**
 * Thrown when a group has no usable official document store — a null/unreadable
 * `officialMountPointId`, or a missing/unparseable `properties.json`. This is a
 * broken invariant, not a routine state: a provisioned group always has a
 * populated store.
 *
 * The read overlay's single-fetch path (`applyGroupStoreOverlayOne`, behind
 * `findById`) throws this. The batched list path (`applyGroupStoreOverlay`,
 * behind `findAll`) catches it, logs at `error`, and drops the offending
 * group so one bad row cannot take down the whole group list.
 */
export class GroupStoreUnavailableError extends Error {
  constructor(
    public readonly groupId: string,
    public readonly officialMountPointId: string | null | undefined,
    detail?: string,
  ) {
    super(
      `Group ${groupId} has no usable document store ` +
        `(officialMountPointId=${officialMountPointId ?? 'null'})` +
        (detail ? `: ${detail}` : ''),
    );
    this.name = 'GroupStoreUnavailableError';
  }
}
