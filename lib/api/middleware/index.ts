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
