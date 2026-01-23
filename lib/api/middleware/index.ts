/**
 * API Middleware Exports
 *
 * Central export point for all API middleware utilities.
 */

// Authentication middleware
export {
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
  enrichWithDefaultImage,
  buildFileReference,
} from './file-path';

// Data enrichment utilities
export {
  enrichWithApiKey,
  enrichWithTags,
  enrichProfile,
  enrichMany,
  unsetAllDefaults,
  type EnrichedApiKey,
  type EnrichedTag,
} from './enrichment';
