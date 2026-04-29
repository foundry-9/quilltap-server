/**
 * Path Resolver for Document Editing Tools
 *
 * Unified path resolution across three scopes:
 * - document_store: files within mounted document stores
 * - project: files within Quilltap project file storage
 * - general: files in general (non-project) file storage
 *
 * All paths are validated against traversal attacks and access control.
 *
 * @module doc-edit/path-resolver
 */

import path from 'path';
import fs from 'fs/promises';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getFilesDir } from '@/lib/paths';
import { getRepositories } from '@/lib/repositories/factory';
import type { DocMountPointType } from '@/lib/schemas/mount-index.types';
import {
  readDatabaseDocument,
  writeDatabaseDocument,
  DatabaseStoreError,
} from '@/lib/mount-index/database-store';

const logger = createServiceLogger('DocEdit:PathResolver');

export type DocEditScope = 'document_store' | 'project' | 'general';

export interface PathResolutionContext {
  /** Current project ID (from chat context) */
  projectId?: string;
  /** Current character ID (from chat context). Used to grant the LLM
   * implicit access to its own character document vault, regardless of
   * whether that vault is linked to the active project. */
  characterId?: string;
  /** Additional character IDs whose vaults should be accessible. Used by
   * the Salon's document-mode handlers to admit every chat participant's
   * vault, not just the single character the LLM is currently speaking as. */
  characterIds?: string[];
  /** Mount point name or ID (required for document_store scope) */
  mountPoint?: string;
}

export interface ResolvedPath {
  /**
   * Absolute filesystem path. For database-backed document stores this is
   * an empty string — callers must dispatch on `mountType` instead.
   */
  absolutePath: string;
  /** The scope that was resolved */
  scope: DocEditScope;
  /** Mount point ID (only for document_store scope) */
  mountPointId?: string;
  /** Mount point name (only for document_store scope) */
  mountPointName?: string;
  /** Mount point backend type (only for document_store scope) */
  mountType?: DocMountPointType;
  /** The base directory that this path is relative to */
  basePath: string;
  /** The relative path within the base */
  relativePath: string;
}

export class PathResolutionError extends Error {
  constructor(
    message: string,
    public code: 'INVALID_PATH' | 'ACCESS_DENIED' | 'NOT_FOUND' | 'MISSING_CONTEXT' | 'TRAVERSAL_ATTEMPT'
  ) {
    super(message);
    this.name = 'PathResolutionError';
  }
}

/**
 * Check if a path contains traversal attempts (.. segments)
 */
function hasTraversalSegments(p: string): boolean {
  const segments = p.split(path.sep);
  return segments.includes('..');
}

/**
 * Check if a path is absolute (Unix or Windows style)
 */
function isAbsolutePath(p: string): boolean {
  return path.isAbsolute(p);
}

/**
 * Safely resolve a real path with fallback to path.resolve if realpath fails.
 *
 * When the leaf doesn't exist yet (e.g. a new file we're about to write),
 * walks up the path to the deepest existing ancestor, realpaths *that*, then
 * re-attaches the missing tail. This keeps boundary checks correct on data
 * directories that live behind a symlink — e.g. `~/iCloud` on macOS, which
 * resolves to `~/Library/Mobile Documents/com~apple~CloudDocs`. Without the
 * walk-up, the file's realpath would expand the symlink while a missing
 * sibling's `path.resolve` would not, and the two sides of a containment
 * check would disagree even though both refer to the same tree.
 */
async function safeRealpath(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    // Walk up to the deepest existing ancestor and realpath that, then
    // re-attach the unresolved tail. This handles "file doesn't exist yet"
    // without losing symlink resolution on the parent directory.
    const tail: string[] = [];
    let current = path.resolve(p);
    while (current !== path.dirname(current)) {
      const parent = path.dirname(current);
      try {
        const realParent = await fs.realpath(parent);
        return path.join(realParent, ...tail.reverse(), path.basename(current));
      } catch {
        tail.push(path.basename(current));
        current = parent;
      }
    }
    return path.resolve(p);
  }
}

/**
 * Verify that a resolved path stays within the expected base directory.
 * Both arguments must already be realpath'd (or both unresolved) so symlink
 * expansion is symmetric — see `safeRealpath` for why that matters.
 */
function verifyPathIsWithinBase(resolvedPath: string, baseDir: string): boolean {
  // Normalize both paths for comparison
  const normalizedResolved = path.normalize(resolvedPath);
  const normalizedBase = path.normalize(baseDir);

  // Ensure base ends with separator for proper containment check
  const baseDirWithSep = normalizedBase.endsWith(path.sep) ? normalizedBase : normalizedBase + path.sep;

  return normalizedResolved.startsWith(baseDirWithSep) || normalizedResolved === normalizedBase;
}

/**
 * Resolve a doc-edit path to an absolute filesystem path.
 * Validates security constraints and access control.
 */
export async function resolveDocEditPath(
  scope: DocEditScope,
  relativePath: string,
  context: PathResolutionContext
): Promise<ResolvedPath> {
  logger.debug(`Resolving ${scope} path: ${relativePath}`);

  // Security check: reject traversal attempts
  if (hasTraversalSegments(relativePath)) {
    logger.warn(`Traversal attempt detected in ${scope} scope: ${relativePath}`);
    throw new PathResolutionError(
      `Path contains traversal segments (..)`,
      'TRAVERSAL_ATTEMPT'
    );
  }

  // Security check: reject absolute paths
  if (isAbsolutePath(relativePath)) {
    logger.warn(`Absolute path attempt in ${scope} scope: ${relativePath}`);
    throw new PathResolutionError(
      `Path must be relative, not absolute`,
      'INVALID_PATH'
    );
  }

  if (scope === 'document_store') {
    return await resolveDocumentStorePath(relativePath, context);
  } else if (scope === 'project') {
    return await resolveProjectPath(relativePath, context);
  } else if (scope === 'general') {
    return await resolveGeneralPath(relativePath, context);
  }

  throw new PathResolutionError(
    `Unknown scope: ${scope}`,
    'INVALID_PATH'
  );
}

function describeCharacters(context: PathResolutionContext): string {
  const ids = new Set<string>();
  if (context.characterId) ids.add(context.characterId);
  if (context.characterIds) {
    for (const id of context.characterIds) ids.add(id);
  }
  return ids.size === 0 ? 'none' : Array.from(ids).join(',');
}

/**
 * Collect the unique set of mount point IDs that the current chat context
 * can reach: every store linked to the active project, plus the active
 * character's own vault (if any). The character vault is always accessible
 * to the LLM acting as that character, even when the vault is not linked
 * to the active project.
 */
async function collectAccessibleMountPointIds(
  context: PathResolutionContext
): Promise<string[]> {
  const repos = getRepositories();
  const ids = new Set<string>();

  if (context.projectId) {
    const projectLinks = await repos.projectDocMountLinks.findByProjectId(context.projectId);
    for (const link of projectLinks) {
      ids.add(link.mountPointId);
    }
  }

  const characterIds = new Set<string>();
  if (context.characterId) characterIds.add(context.characterId);
  if (context.characterIds) {
    for (const id of context.characterIds) characterIds.add(id);
  }

  for (const characterId of characterIds) {
    const character = await repos.characters.findById(characterId);
    if (character?.characterDocumentMountPointId) {
      ids.add(character.characterDocumentMountPointId);
    }
  }

  return Array.from(ids);
}

/**
 * Resolve a path within a mounted document store
 */
async function resolveDocumentStorePath(
  relativePath: string,
  context: PathResolutionContext
): Promise<ResolvedPath> {
  if (!context.mountPoint) {
    logger.warn('document_store scope requires mountPoint in context');
    throw new PathResolutionError(
      'Mount point is required for document_store scope',
      'MISSING_CONTEXT'
    );
  }

  const hasCharacterContext = Boolean(context.characterId) || (context.characterIds?.length ?? 0) > 0;
  if (!context.projectId && !hasCharacterContext) {
    logger.warn('document_store scope requires projectId or characterId in context');
    throw new PathResolutionError(
      'Project ID or character ID is required for document_store scope',
      'MISSING_CONTEXT'
    );
  }

  const repos = getRepositories();
  const accessibleIds = await collectAccessibleMountPointIds(context);

  if (accessibleIds.length === 0) {
    logger.debug(
      `No mount points accessible for project=${context.projectId ?? 'none'} characters=${describeCharacters(context)}`,
    );
    throw new PathResolutionError(
      `No document stores accessible in this context`,
      'ACCESS_DENIED'
    );
  }

  // Try to find mount point by name first (case-insensitive), then by ID
  let mountPoint = null;
  const needle = context.mountPoint.toLowerCase();
  for (const id of accessibleIds) {
    const mp = await repos.docMountPoints.findById(id);
    if (mp && mp.name.toLowerCase() === needle) {
      mountPoint = mp;
      break;
    }
  }

  if (!mountPoint) {
    for (const id of accessibleIds) {
      if (id === context.mountPoint) {
        const mp = await repos.docMountPoints.findById(id);
        if (mp) {
          mountPoint = mp;
          break;
        }
      }
    }
  }

  if (!mountPoint) {
    logger.warn(
      `Mount point not found or not accessible: ${context.mountPoint} (project: ${context.projectId ?? 'none'}, characters: ${describeCharacters(context)})`
    );
    throw new PathResolutionError(
      `Mount point not found or not accessible in this context`,
      'NOT_FOUND'
    );
  }

  if (!mountPoint.enabled) {
    logger.warn(`Attempt to access disabled mount point: ${mountPoint.id}`);
    throw new PathResolutionError(
      `Mount point is disabled`,
      'ACCESS_DENIED'
    );
  }

  // Database-backed stores have no filesystem path. Everything the doc-edit
  // helpers need comes from (mountPointId, relativePath); callers dispatch
  // on `mountType` to decide whether to read from disk or from the DB.
  if (mountPoint.mountType === 'database') {
    logger.debug(`Resolved database-backed document_store path: ${relativePath}`);
    return {
      absolutePath: '',
      scope: 'document_store',
      mountPointId: mountPoint.id,
      mountPointName: mountPoint.name,
      mountType: 'database',
      basePath: '',
      relativePath,
    };
  }

  const baseDir = mountPoint.basePath;
  const joinedPath = path.join(baseDir, relativePath);
  const [realBase, realPath] = await Promise.all([
    safeRealpath(baseDir),
    safeRealpath(joinedPath),
  ]);

  // Verify path stays within base directory
  if (!verifyPathIsWithinBase(realPath, realBase)) {
    logger.warn(
      `Path resolution escaped base directory: ${relativePath} -> ${realPath} (base: ${realBase})`
    );
    throw new PathResolutionError(
      `Path escapes mount point boundary`,
      'TRAVERSAL_ATTEMPT'
    );
  }

  logger.debug(`Resolved document_store path: ${relativePath} -> ${realPath}`);

  return {
    absolutePath: realPath,
    scope: 'document_store',
    mountPointId: mountPoint.id,
    mountPointName: mountPoint.name,
    mountType: mountPoint.mountType,
    basePath: baseDir,
    relativePath,
  };
}

/**
 * Resolve a path within a project's file storage.
 *
 * Projects own a "project-official" document store (see
 * `projects.officialMountPointId` and the `convert-project-files-to-document-stores`
 * migration). When set, `scope: 'project'` is just an alias for that mount —
 * which is what Prospero advertises to the LLM. We dispatch through the mount
 * point so reads/writes land in the same place the Scriptorium UI sees, and
 * fall back to the legacy on-disk `<filesDir>/<projectId>/` layout only when
 * no official mount has been provisioned yet.
 */
async function resolveProjectPath(
  relativePath: string,
  context: PathResolutionContext
): Promise<ResolvedPath> {
  if (!context.projectId) {
    logger.warn('project scope requires projectId in context');
    throw new PathResolutionError(
      'Project ID is required for project scope',
      'MISSING_CONTEXT'
    );
  }

  const repos = getRepositories();
  const project = await repos.projects.findById(context.projectId);
  const officialMountPointId = project?.officialMountPointId ?? null;

  if (officialMountPointId) {
    const mountPoint = await repos.docMountPoints.findById(officialMountPointId);
    if (mountPoint && mountPoint.enabled) {
      if (mountPoint.mountType === 'database') {
        logger.debug(
          `Resolved project path via official database mount: ${relativePath} (mount=${mountPoint.id})`
        );
        return {
          absolutePath: '',
          scope: 'project',
          mountPointId: mountPoint.id,
          mountPointName: mountPoint.name,
          mountType: 'database',
          basePath: '',
          relativePath,
        };
      }

      const baseDir = mountPoint.basePath;
      const joinedPath = path.join(baseDir, relativePath);
      const [realBase, realPath] = await Promise.all([
        safeRealpath(baseDir),
        safeRealpath(joinedPath),
      ]);
      if (!verifyPathIsWithinBase(realPath, realBase)) {
        logger.warn(
          `Path resolution escaped official project mount: ${relativePath} -> ${realPath} (base: ${realBase})`
        );
        throw new PathResolutionError(
          `Path escapes project boundary`,
          'TRAVERSAL_ATTEMPT'
        );
      }
      logger.debug(
        `Resolved project path via official ${mountPoint.mountType} mount: ${relativePath} -> ${realPath}`
      );
      return {
        absolutePath: realPath,
        scope: 'project',
        mountPointId: mountPoint.id,
        mountPointName: mountPoint.name,
        mountType: mountPoint.mountType,
        basePath: realBase,
        relativePath,
      };
    }
    logger.warn(
      `Project ${context.projectId} has officialMountPointId=${officialMountPointId} but mount point is missing or disabled — falling back to legacy filesystem path`
    );
  }

  const filesDir = getFilesDir();
  const baseDir = path.join(filesDir, context.projectId);
  const joinedPath = path.join(baseDir, relativePath);
  const [realBase, realPath] = await Promise.all([
    safeRealpath(baseDir),
    safeRealpath(joinedPath),
  ]);

  // Verify path stays within project directory
  if (!verifyPathIsWithinBase(realPath, realBase)) {
    logger.warn(
      `Path resolution escaped project directory: ${relativePath} -> ${realPath} (base: ${realBase})`
    );
    throw new PathResolutionError(
      `Path escapes project boundary`,
      'TRAVERSAL_ATTEMPT'
    );
  }

  logger.debug(`Resolved project path (legacy fs): ${relativePath} -> ${realPath}`);

  return {
    absolutePath: realPath,
    scope: 'project',
    basePath: realBase,
    relativePath,
  };
}

/**
 * Resolve a path within general (non-project) file storage
 */
async function resolveGeneralPath(
  relativePath: string,
  context: PathResolutionContext
): Promise<ResolvedPath> {
  const filesDir = getFilesDir();
  const baseDir = path.join(filesDir, '_general');
  const joinedPath = path.join(baseDir, relativePath);
  const [realBase, realPath] = await Promise.all([
    safeRealpath(baseDir),
    safeRealpath(joinedPath),
  ]);

  // Verify path stays within general directory
  if (!verifyPathIsWithinBase(realPath, realBase)) {
    logger.warn(
      `Path resolution escaped general directory: ${relativePath} -> ${realPath} (base: ${realBase})`
    );
    throw new PathResolutionError(
      `Path escapes general storage boundary`,
      'TRAVERSAL_ATTEMPT'
    );
  }

  logger.debug(`Resolved general path: ${relativePath} -> ${realPath}`);

  return {
    absolutePath: realPath,
    scope: 'general',
    basePath: realBase,
    relativePath,
  };
}

/**
 * Input to the dispatching read/write helpers. Either a bare absolute path
 * (legacy, filesystem-only) or a ResolvedPath — the latter lets us route
 * database-backed mount points through the database-store module.
 */
export type ReadWriteTarget = string | ResolvedPath;

function isResolvedPath(target: ReadWriteTarget): target is ResolvedPath {
  return typeof target !== 'string';
}

function isDatabaseBacked(resolved: ResolvedPath): boolean {
  return resolved.mountType === 'database';
}

/**
 * Read a file and return its content with modification time.
 * Used for the read-then-replace workflow. For database-backed document
 * stores, the bytes are fetched from doc_mount_documents instead of disk.
 */
export async function readFileWithMtime(
  target: ReadWriteTarget
): Promise<{
  content: string;
  mtime: number;
  size: number;
}> {
  if (isResolvedPath(target) && isDatabaseBacked(target)) {
    if (!target.mountPointId) {
      throw new Error('Database-backed ResolvedPath is missing mountPointId');
    }
    try {
      return await readDatabaseDocument(target.mountPointId, target.relativePath);
    } catch (error) {
      if (error instanceof DatabaseStoreError && error.code === 'NOT_FOUND') {
        // Align with fs.readFile's ENOENT so callers can detect "file
        // doesn't exist" uniformly.
        const notFound: NodeJS.ErrnoException = Object.assign(
          new Error(`ENOENT: database document not found at ${target.relativePath}`),
          { code: 'ENOENT' }
        );
        throw notFound;
      }
      throw error;
    }
  }

  const absolutePath = isResolvedPath(target) ? target.absolutePath : target;
  try {
    const [content, stats] = await Promise.all([
      fs.readFile(absolutePath, 'utf-8'),
      fs.stat(absolutePath),
    ]);

    logger.debug(`Read file: ${absolutePath} (${stats.size} bytes)`);

    return {
      content,
      mtime: stats.mtime.getTime(),
      size: stats.size,
    };
  } catch (error) {
    if (error instanceof Error) {
      logger.warn(`Failed to read file ${absolutePath}: ${error.message}`);
      throw error;
    }
    throw error;
  }
}

/**
 * Write a file with optional mtime-based concurrency check.
 * If expectedMtime is provided and the file's current mtime doesn't match,
 * the write is rejected (file was modified by another process). For
 * database-backed document stores the same check runs against the stored
 * lastModified timestamp.
 */
export async function writeFileWithMtimeCheck(
  target: ReadWriteTarget,
  content: string,
  expectedMtime?: number
): Promise<{ mtime: number }> {
  if (isResolvedPath(target) && isDatabaseBacked(target)) {
    if (!target.mountPointId) {
      throw new Error('Database-backed ResolvedPath is missing mountPointId');
    }
    return await writeDatabaseDocument(
      target.mountPointId,
      target.relativePath,
      content,
      expectedMtime
    );
  }

  const absolutePath = isResolvedPath(target) ? target.absolutePath : target;
  try {
    // If expectedMtime is provided, verify the file hasn't changed
    if (expectedMtime !== undefined) {
      try {
        const stats = await fs.stat(absolutePath);
        const currentMtime = stats.mtime.getTime();

        if (currentMtime !== expectedMtime) {
          logger.warn(
            `Concurrency conflict on ${absolutePath}: expected mtime ${expectedMtime}, got ${currentMtime}`
          );
          throw new Error(
            `File was modified by another process (mtime mismatch). Please reload and try again.`
          );
        }
      } catch (statError) {
        // File doesn't exist yet, which is fine - create it
        if (
          !(statError instanceof Error && 'code' in statError && (statError as NodeJS.ErrnoException).code === 'ENOENT')
        ) {
          throw statError;
        }
      }
    }

    // Ensure parent directory exists
    const parentDir = path.dirname(absolutePath);
    await fs.mkdir(parentDir, { recursive: true });

    // Write the file
    await fs.writeFile(absolutePath, content, 'utf-8');

    // Get the new mtime
    const stats = await fs.stat(absolutePath);
    const mtime = stats.mtime.getTime();

    logger.debug(`Wrote file: ${absolutePath} (${content.length} bytes)`);

    return { mtime };
  } catch (error) {
    if (error instanceof Error) {
      logger.warn(`Failed to write file ${absolutePath}: ${error.message}`);
      throw error;
    }
    throw error;
  }
}

export interface AccessibleMountPoint {
  id: string;
  name: string;
  basePath: string;
  mountType: DocMountPointType;
}

/**
 * List all accessible mount points for the current chat context:
 * every store linked to the project, plus the active character's own
 * vault (if any), deduped. Used by doc_list_files, doc_grep, and the
 * blob helpers to enumerate available sources.
 */
export async function getAccessibleMountPoints(
  projectId: string | undefined,
  characterId?: string,
  extraCharacterIds?: string[],
): Promise<AccessibleMountPoint[]> {
  try {
    const repos = getRepositories();
    const ids = await collectAccessibleMountPointIds({
      projectId,
      characterId,
      characterIds: extraCharacterIds && extraCharacterIds.length > 0 ? extraCharacterIds : undefined,
    });

    if (ids.length === 0) {
      logger.debug(
        `No mount points accessible for project=${projectId ?? 'none'} character=${characterId ?? 'none'}`,
      );
      return [];
    }

    const mountPoints: AccessibleMountPoint[] = [];
    for (const id of ids) {
      const mountPoint = await repos.docMountPoints.findById(id);
      if (mountPoint && mountPoint.enabled) {
        mountPoints.push({
          id: mountPoint.id,
          name: mountPoint.name,
          basePath: mountPoint.basePath,
          mountType: mountPoint.mountType,
        });
      }
    }

    logger.debug(
      `Found ${mountPoints.length} accessible mount points for project=${projectId ?? 'none'} character=${characterId ?? 'none'} peers=${extraCharacterIds?.length ?? 0}`,
    );

    return mountPoints;
  } catch (error) {
    if (error instanceof Error) {
      logger.warn(`Failed to get accessible mount points: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Check if a file path points to a text-like file (safe to read/write as text).
 * Rejects binary files like images, PDFs, etc.
 */
export function isTextFile(filePath: string): boolean {
  const allowedExtensions = new Set([
    '.md',
    '.markdown',
    '.txt',
    '.json',
    '.jsonl',
    '.ndjson',
    '.yaml',
    '.yml',
    '.xml',
    '.html',
    '.htm',
    '.css',
    '.js',
    '.ts',
    '.jsx',
    '.tsx',
    '.py',
    '.rb',
    '.sh',
    '.bash',
    '.zsh',
    '.csv',
    '.toml',
    '.ini',
    '.cfg',
    '.conf',
    '.log',
    '.env',
    '.gitignore',
    '.editorconfig',
  ]);

  const ext = path.extname(filePath).toLowerCase();
  const isAllowed = allowedExtensions.has(ext);

  if (!isAllowed) {
    logger.debug(`File rejected as non-text: ${filePath} (extension: ${ext})`);
  }

  return isAllowed;
}
