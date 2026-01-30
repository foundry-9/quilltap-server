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
    s3?: ServiceHealth;
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

    const mountPoints = fileStorageManager.getMountPoints();

    if (mountPoints.length === 0) {
      services.s3 = {
        status: 'degraded',
        message: 'No file storage mount points configured',
      };
      serviceStatuses.push('degraded');
      healthLogger.warn('No file storage mount points configured');
      return;
    }

    // Test the default backend
    const defaultBackend = await fileStorageManager.getDefaultBackend();
    const metadata = defaultBackend.getMetadata();

    services.s3 = {
      status: 'healthy',
      message: `File storage operational (${metadata.displayName})`,
      mode: metadata.displayName,
    };
    serviceStatuses.push('healthy');

  } catch (error) {
    const errorMessage = getErrorMessage(error);
    services.s3 = {
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
