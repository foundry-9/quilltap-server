/**
 * Health check endpoint for monitoring
 * Checks connectivity for JSON store and file storage
 * Returns 200 OK if healthy, 503 if degraded or unhealthy
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { fileStorageManager } from '@/lib/file-storage/manager';
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
 * Check JSON store health
 */
async function checkJsonStoreHealth(
  healthLogger: ReturnType<typeof logger.child>,
  services: HealthResponse['services'],
  serviceStatuses: HealthStatus[]
): Promise<void> {

  try {
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
    healthLogger.warn('JSON store health check failed', { error: errorMessage });
  }
}

/**
 * Check file storage health
 */
async function checkFileStorageHealth(
  healthLogger: ReturnType<typeof logger.child>,
  services: HealthResponse['services'],
  serviceStatuses: HealthStatus[]
): Promise<void> {


  try {
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
    healthLogger.error('File storage health check error', { error: errorMessage });
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
  const healthLogger = logger.child({ module: 'health' });
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
  } catch {
    // startupState not yet initialized — continue with normal health check
  }

  try {
    const timestamp = new Date().toISOString();
    const uptime = process.uptime();
    const environment = process.env.NODE_ENV;

    const services: HealthResponse['services'] = {};
    const serviceStatuses: HealthStatus[] = [];

    // Check JSON store (always available as fallback)
    await checkJsonStoreHealth(healthLogger, services, serviceStatuses);

    // Check file storage
    await checkFileStorageHealth(healthLogger, services, serviceStatuses);

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

    const checkDuration = Date.now() - startTime;
    healthLogger.info('Health check complete', {
      status: overallStatus,
      statusCode,
      durationMs: checkDuration,
      servicesChecked: Object.keys(services),
    });

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

    healthLogger.error('Health check failed with unexpected error', {
      error: errorMessage,
      durationMs: checkDuration,
    });

    return NextResponse.json(health, { status: 503 });
  }
}
