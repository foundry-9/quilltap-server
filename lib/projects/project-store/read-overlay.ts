/**
 * Read overlay for the project document store.
 *
 * Re-assembles the hydrated, app-facing `Project` from the slim DB row plus the
 * project's official-store files (`description.md`, `instructions.md`,
 * `state.json`, `properties.json`). The store is the sole source of truth — this
 * overlay never falls back to legacy DB columns.
 *
 * The behaviour lives in the generic engine (`lib/database/document-store-overlay`);
 * this module re-exports the project-bound read operations. Failure is asymmetric:
 *   - {@link applyProjectStoreOverlayOne} (single, behind `findById`) THROWS
 *     `ProjectStoreUnavailableError`.
 *   - {@link applyProjectStoreOverlay} (batched, behind `findAll`/roster reads)
 *     logs at `error` and DROPS the offending project so one corrupt row can't
 *     take down the whole project list. The startup backfill heals it.
 *
 * @module projects/project-store/read-overlay
 */

export { applyProjectStoreOverlay, applyProjectStoreOverlayOne } from './overlay';
