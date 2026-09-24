/**
 * API Middleware Exports
 *
 * Central export point for all API middleware utilities.
 */

// Request context middleware
export {
  withContext,
  withContextParams,
  createContextHandler,
  createContextParamsHandler,
  exists,
  type RequestContext,
  type ContextHandler,
  type ContextParamsHandler,
} from './context';

// Action parameter middleware (v1 API consolidation)
export {
  withActionDispatch,
  withCollectionActionDispatch,
  dispatchAction,
  getActionParam,
  isValidAction,
  getQueryParamsWithoutAction,
  type ActionHandler,
  type ActionHandlerMap,
  type ActionThunk,
  type ActionThunkMap,
} from './actions';

// File path utilities
export {
  getFilePath,
  getAvatarPath,
  buildFileReference,
} from './file-path';

// Data enrichment utilities
export {
  enrichWithApiKey,
  enrichWithTags,
  resolveEditorTags,
  enrichWithDefaultImage,
  enrichProfile,
  type EnrichedApiKey,
  type EnrichedTag,
  type EditorTag,
  type EnrichedDefaultImage,
} from './enrichment';
