/**
 * Health check endpoint for monitoring
 * Checks connectivity for JSON store and file storage
 * Returns 200 OK if healthy, 503 if degraded or unhealthy
 *
 * IMPORTANT: This route uses dynamic imports for database and file storage
 * modules to avoid crashing the route handler if native modules (e.g.,
 * better-sqlite3) fail to load. This ensures the health endpoint always
 * returns valid JSON, even during startup or when modules are unavailable.
 */

import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

interface ServiceHealth {
  status: HealthStatus;
  message: string;
  latencyMs?: number;
  mode?: string;
}

interface HealthResponse {
  status: HealthStatus;
  timestamp: string;
  uptime: number;
  environment: string | undefined;
  services: {
    json?: ServiceHealth;
    fileStorage?: ServiceHealth;
  };
}

/**
 * Check JSON store health (uses dynamic import to avoid crashing on native module issues)
 */
async function checkJsonStoreHealth(
  services: HealthResponse['services'],
  serviceStatuses: HealthStatus[]
): Promise<void> {

  try {
    const { getRepositories } = await import('@/lib/repositories/factory');
    const repos = getRepositories();
    await repos.users.getCurrentUser();

    services.json = {
      status: 'healthy',
      message: 'JSON store is operational',
    };
    serviceStatuses.push('healthy');

  } catch (error) {
    const errorMessage = getErrorMessage(error);
    services.json = {
      status: 'unhealthy',
      message: `JSON store check failed: ${errorMessage}`,
    };
    serviceStatuses.push('unhealthy');
    try {
      const { logger } = await import('@/lib/logger');
      logger.child({ module: 'health' }).warn('JSON store health check failed', { error: errorMessage });
    } catch { /* logger unavailable */ }
  }
}

/**
 * Check file storage health (uses dynamic import to avoid crashing on native module issues)
 */
async function checkFileStorageHealth(
  services: HealthResponse['services'],
  serviceStatuses: HealthStatus[]
): Promise<void> {

  try {
    const { fileStorageManager } = await import('@/lib/file-storage/manager');
    if (!fileStorageManager.isInitialized()) {
      await fileStorageManager.initialize();
    }

    services.fileStorage = {
      status: 'healthy',
      message: 'Local file storage operational',
      mode: 'local',
    };
    serviceStatuses.push('healthy');

  } catch (error) {
    const errorMessage = getErrorMessage(error);
    services.fileStorage = {
      status: 'unhealthy',
      message: `File storage health check error: ${errorMessage}`,
    };
    serviceStatuses.push('unhealthy');
    try {
      const { logger } = await import('@/lib/logger');
      logger.child({ module: 'health' }).error('File storage health check error', { error: errorMessage });
    } catch { /* logger unavailable */ }
  }
}

/**
 * Determine overall health status from service statuses
 */
function getOverallStatus(serviceStatuses: HealthStatus[]): HealthStatus {
  if (serviceStatuses.includes('unhealthy')) {
    return 'unhealthy';
  }
  if (serviceStatuses.includes('degraded')) {
    return 'degraded';
  }
  return 'healthy';
}

/**
 * Get HTTP status code based on overall health status
 */
function getStatusCode(status: HealthStatus): number {
  return status === 'healthy' ? 200 : 503;
}

export async function GET() {
  const startTime = Date.now();

  // Locked mode: return 423 without touching the database
  try {
    const { startupState } = await import('@/lib/startup/startup-state');
    if (startupState.isLockedMode()) {
      return NextResponse.json({
        status: 'locked',
        dbKeyState: startupState.getPepperState(),
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      }, { status: 423 });
    }

    // Check for instance lock conflict (database held by another process)
    const lockConflict = startupState.getInstanceLockConflict();
    if (lockConflict) {
      return NextResponse.json({
        status: 'lock-conflict',
        lockConflict,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      }, { status: 409 });
    }

    // Check for version guard block (running older version against newer database)
    const versionBlock = startupState.getVersionGuardBlock();
    if (versionBlock) {
      return NextResponse.json({
        status: 'version-blocked',
        versionBlock,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      }, { status: 409 });
    }

    // If startup hasn't completed yet (still in pending/migrations phase),
    // return a minimal response so the health checker gets valid JSON
    const phase = startupState.getPhase();
    if (phase === 'pending' || phase === 'migrations' || phase === 'seeding' ||
        phase === 'plugin-updates' || phase === 'plugins' || phase === 'file-storage') {
      return NextResponse.json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV,
        services: {},
        startupPhase: phase,
      }, { status: 503 });
    }
  } catch {
    // startupState not yet initialized — return minimal response
    return NextResponse.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
      services: {},
      startupPhase: 'initializing',
    }, { status: 503 });
  }

  try {
    const timestamp = new Date().toISOString();
    const uptime = process.uptime();
    const environment = process.env.NODE_ENV;

    const services: HealthResponse['services'] = {};
    const serviceStatuses: HealthStatus[] = [];

    // Check JSON store (always available as fallback)
    await checkJsonStoreHealth(services, serviceStatuses);

    // Check file storage
    await checkFileStorageHealth(services, serviceStatuses);

    // Determine overall status
    const overallStatus = getOverallStatus(serviceStatuses);
    const statusCode = getStatusCode(overallStatus);

    const health: HealthResponse = {
      status: overallStatus,
      timestamp,
      uptime,
      environment,
      services,
    };

    return NextResponse.json(health, { status: statusCode });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    const checkDuration = Date.now() - startTime;

    const health: HealthResponse = {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
      services: {
        json: {
          status: 'unhealthy',
          message: `Unexpected health check error: ${errorMessage}`,
        },
      },
    };

    try {
      const { logger } = await import('@/lib/logger');
      logger.child({ module: 'health' }).error('Health check failed with unexpected error', {
        error: errorMessage,
        durationMs: checkDuration,
      });
    } catch { /* logger unavailable */ }

    return NextResponse.json(health, { status: 503 });
  }
}
