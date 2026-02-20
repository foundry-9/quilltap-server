/**
 * API Middleware Exports
 *
 * Central export point for all API middleware utilities.
 */

// Request context middleware
export {
  // Primary exports
  withContext,
  withContextParams,
  createContextHandler,
  createContextParamsHandler,
  exists,
  type RequestContext,
  type ContextHandler,
  type ContextParamsHandler,
  // Legacy aliases (deprecated)
  withAuth,
  withAuthParams,
  createAuthenticatedHandler,
  createAuthenticatedParamsHandler,
  checkOwnership,
  type AuthenticatedContext,
  type AuthenticatedHandler,
  type AuthenticatedParamsHandler,
} from './auth';

// Action parameter middleware (v1 API consolidation)
export {
  withActionDispatch,
  withCollectionActionDispatch,
  getActionParam,
  isValidAction,
  getQueryParamsWithoutAction,
  type ActionHandler,
  type ActionHandlerMap,
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
  enrichWithDefaultImage,
  enrichProfile,
  enrichMany,
  unsetAllDefaults,
  type EnrichedApiKey,
  type EnrichedTag,
  type EnrichedDefaultImage,
} from './enrichment';
