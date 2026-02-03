/**
 * System Data Directory API v1
 *
 * GET /api/v1/system/data-dir - Returns data directory information
 * POST /api/v1/system/data-dir?action=open - Opens the data directory in the system file browser
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { successResponse, errorResponse, badRequest } from '@/lib/api/responses';
import {
  getBaseDataDirWithSource,
  getPlatform,
  isDockerEnvironment,
  Platform,
} from '@/lib/paths';
import { logger } from '@/lib/logger';

const execAsync = promisify(exec);

/**
 * Response shape for data directory info
 */
interface DataDirInfo {
  /** The base data directory path */
  path: string;
  /** Where the path came from */
  source: 'environment' | 'platform-default';
  /** Human-readable description of the source */
  sourceDescription: string;
  /** Current platform */
  platform: Platform;
  /** Whether running in Docker */
  isDocker: boolean;
  /** Whether the "open" action is supported */
  canOpen: boolean;
}

/**
 * GET /api/v1/system/data-dir
 * Returns information about the data directory location
 */
export async function GET() {
  const dirInfo = getBaseDataDirWithSource();
  const platform = getPlatform();
  const isDocker = isDockerEnvironment();

  const response: DataDirInfo = {
    path: dirInfo.path,
    source: dirInfo.source,
    sourceDescription: dirInfo.sourceDescription,
    platform,
    isDocker,
    // Can only open file browser on non-Docker systems
    canOpen: !isDocker,
  };

  logger.debug('Data directory info requested', { response });

  return successResponse(response);
}

/**
 * POST /api/v1/system/data-dir?action=open
 * Opens the data directory in the system file browser
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (action !== 'open') {
    return badRequest('Invalid action. Supported actions: open');
  }

  const isDocker = isDockerEnvironment();
  if (isDocker) {
    logger.debug('Cannot open file browser in Docker environment');
    return errorResponse(
      'Cannot open file browser in Docker environment. Access the data directory through your host system or container volume mounts.',
      400
    );
  }

  const dirInfo = getBaseDataDirWithSource();
  const platform = getPlatform();
  const dirPath = dirInfo.path;

  logger.debug('Attempting to open data directory', { platform, path: dirPath });

  try {
    let command: string;

    switch (platform) {
      case 'darwin':
        // macOS: use open command
        command = `open "${dirPath}"`;
        break;

      case 'win32':
        // Windows: use explorer command
        command = `explorer "${dirPath}"`;
        break;

      case 'linux':
      default:
        // Linux: try xdg-open (standard), fallback to common file managers
        command = `xdg-open "${dirPath}" 2>/dev/null || nautilus "${dirPath}" 2>/dev/null || dolphin "${dirPath}" 2>/dev/null || thunar "${dirPath}" 2>/dev/null`;
        break;
    }

    await execAsync(command);

    logger.info('Opened data directory in file browser', { platform, path: dirPath });

    return successResponse({
      message: 'Data directory opened in file browser',
      path: dirPath,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to open data directory', { error: errorMessage, platform, path: dirPath });

    return errorResponse(
      `Failed to open file browser: ${errorMessage}`,
      500
    );
  }
}
