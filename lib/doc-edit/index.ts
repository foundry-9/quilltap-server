/**
 * Document Editing Module
 *
 * Foundation layer for Scriptorium Phase 3.3 editing tools.
 * Provides path resolution, diacritics normalization, markdown parsing,
 * and single-file re-indexing.
 *
 * @module doc-edit
 */

export {
  normalizeDiacritics,
  findAllMatches,
  findUniqueMatch,
  type DiacriticsMatchOptions,
} from './diacritics';

export {
  resolveDocEditPath,
  readFileWithMtime,
  writeFileWithMtimeCheck,
  getAccessibleMountPoints,
  isTextFile,
  PathResolutionError,
  type DocEditScope,
  type PathResolutionContext,
  type ResolvedPath,
} from './path-resolver';

export {
  parseFrontmatter,
  serializeFrontmatter,
  updateFrontmatterInContent,
  slugifyHeading,
  parseHeadingTree,
  findHeadingSection,
  readHeadingContent,
  replaceHeadingContent,
  type ParsedFrontmatter,
  type HeadingInfo,
} from './markdown-parser';

export {
  generateUnifiedDiff,
  formatAutosaveNotification,
} from './unified-diff';

export {
  reindexSingleFile,
} from './reindex-file';
