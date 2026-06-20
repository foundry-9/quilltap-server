/**
 * Public surface of the SVAR adapter.
 *
 * The pure, SVAR-runtime-free translation layer: event→route mapping, listing→
 * tree mapping, error translation, and the post-copy reindex decision. The
 * runtime factory (`createSvarAdapter`, Phase 3) that wires these into a live
 * SVAR `api.intercept()` is added later; this index already gives the page and
 * the tests everything they need without pulling in the SVAR runtime.
 *
 * Quarantine: `@svar-ui/*` is imported only by `./svar-types`. Consumers import
 * from here and pass the adapter's output to the SVAR component as opaque data.
 *
 * @module components/files/svar
 */

export {
  mapSvarEvent,
  mapRename,
  mapCreate,
  mapDelete,
  mapMove,
  mapCopy,
  mapOpen,
  mapDownload,
} from './event-route-map'
export type { RouteCall, NodeResolver, ResolvedNode, MapContext, SvarOp } from './event-route-map'

export { listingToTree } from './listing-to-tree'
export type { MountListing } from './listing-to-tree'

export { translateMountOpError } from './error-translation'
export type { ErrorVerdict, MountOpErrorCode } from './error-translation'

export { reindexAfterCopy } from './reindex-after-copy'
export type { ReindexTarget, FileOpResultLike } from './reindex-after-copy'

// Runtime wiring core (no SVAR-component import — safe to pull without the
// runtime). The React wrapper `SvarFileManager` is imported directly by the
// page, not re-exported here, so this surface stays runtime-free.
export { wireSvarAdapter, loadMountTree, HttpError } from './createSvarAdapter'
export type { AdapterConfig, AdapterCallbacks } from './createSvarAdapter'

export { relPathToNodeId, nodeIdToRelPath, relDirname, relBasename, relJoin, extOf, encodeRelPath } from './node-id'
