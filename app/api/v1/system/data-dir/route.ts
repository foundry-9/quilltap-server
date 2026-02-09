/**
 * System Data Directory API v1
 *
 * GET /api/v1/system/data-dir - Returns data directory information
 * POST /api/v1/system/data-dir?action=open - Opens the data directory in the system file browser
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { successResponse, errorResponse, badRequest } from '@/lib/api/responses';
import {
  getBaseDataDirWithSource,
  getPlatform,
  isDockerEnvironment,
  Platform,
} from '@/lib/paths';
import { logger } from '@/lib/logger';

const execFileAsync = promisify(execFile);

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
    return errorResponse(
      'Cannot open file browser in Docker environment. Access the data directory through your host system or container volume mounts.',
      400
    );
  }

  const dirInfo = getBaseDataDirWithSource();
  const platform = getPlatform();
  const dirPath = dirInfo.path;

  try {
    switch (platform) {
      case 'darwin':
        // macOS: use open command
        await execFileAsync('open', [dirPath]);
        break;

      case 'win32':
        // Windows: use explorer command
        await execFileAsync('explorer', [dirPath]);
        break;

      case 'linux':
      default:
        // Linux: try xdg-open (standard), fallback to common file managers
        await openLinuxFileBrowser(dirPath);
        break;
    }

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

/**
 * Try to open a file browser on Linux using common file manager commands.
 * Uses execFile with sequential fallbacks (no shell chaining).
 */
async function openLinuxFileBrowser(dirPath: string): Promise<void> {
  const commands = ['xdg-open', 'nautilus', 'dolphin', 'thunar'];

  for (const cmd of commands) {
    try {
      await execFileAsync(cmd, [dirPath]);
      return;
    } catch {
      // Try the next file manager
      logger.debug(`File manager '${cmd}' not available, trying next`, { dirPath });
    }
  }

  throw new Error('No supported file manager found. Tried: ' + commands.join(', '));
}
