/**
 * Read overlay for the group document store.
 *
 * Re-assembles the hydrated, app-facing `Group` from the slim DB row plus the
 * group's official-store files (`description.md`, `instructions.md`,
 * `state.json`, `properties.json`). The store is the sole source of truth — this
 * overlay never falls back to legacy DB columns.
 *
 * The behaviour lives in the generic engine (`lib/database/document-store-overlay`);
 * this module re-exports the group-bound read operations. Failure is asymmetric:
 *   - {@link applyGroupStoreOverlayOne} (single, behind `findById`) THROWS
 *     `GroupStoreUnavailableError`.
 *   - {@link applyGroupStoreOverlay} (batched, behind `findAll`) logs at `error`
 *     and DROPS the offending group so one corrupt row can't take down the whole
 *     group list. The startup backfill heals it.
 *
 * @module groups/group-store/read-overlay
 */

export { applyGroupStoreOverlay, applyGroupStoreOverlayOne } from './overlay';
