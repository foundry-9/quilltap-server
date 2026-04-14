/**
 * System Directory Browser API v1
 *
 * GET /api/v1/system/browse-directory?path=/some/path
 *   Lists subdirectories of the given path for the directory picker UI.
 *   Returns the resolved path and its immediate subdirectories.
 *
 * GET /api/v1/system/browse-directory
 *   Lists subdirectories of the user's home directory.
 */

import { NextRequest } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createContextHandler } from '@/lib/api/middleware';
import { successResponse, errorResponse, badRequest } from '@/lib/api/responses';
import { logger } from '@/lib/logger';

export const GET = createContextHandler(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);
    const requestedPath = searchParams.get('path') || os.homedir();

    // Resolve and normalize the path
    const resolvedPath = path.resolve(requestedPath);

    logger.debug('[Browse Directory] Listing directories', {
      requestedPath,
      resolvedPath,
    });

    // Verify the path exists and is a directory
    let stat;
    try {
      stat = await fs.stat(resolvedPath);
    } catch {
      return badRequest(`Path does not exist: ${resolvedPath}`);
    }

    if (!stat.isDirectory()) {
      return badRequest(`Path is not a directory: ${resolvedPath}`);
    }

    // Read directory entries
    let entries;
    try {
      entries = await fs.readdir(resolvedPath, { withFileTypes: true });
    } catch (err) {
      logger.debug('[Browse Directory] Cannot read directory', {
        path: resolvedPath,
        error: err instanceof Error ? err.message : String(err),
      });
      return successResponse({
        path: resolvedPath,
        parent: path.dirname(resolvedPath) !== resolvedPath ? path.dirname(resolvedPath) : null,
        directories: [],
        error: 'Permission denied',
      });
    }

    // Filter to directories only, skip hidden dirs
    const directories = entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => ({
        name: entry.name,
        path: path.join(resolvedPath, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const parent = path.dirname(resolvedPath) !== resolvedPath
      ? path.dirname(resolvedPath)
      : null;

    return successResponse({
      path: resolvedPath,
      parent,
      directories,
    });
  } catch (error) {
    logger.error('[Browse Directory] Error browsing directory', {},
      error instanceof Error ? error : undefined);
    return errorResponse('Failed to browse directory', 500);
  }
});
