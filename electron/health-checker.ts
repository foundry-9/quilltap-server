import * as http from 'http';
import {
  HEALTH_URL,
  HEALTH_POLL_INTERVAL_MS,
  HEALTH_MAX_ATTEMPTS,
} from './constants';
import { HealthStatus } from './types';

/**
 * Polls the Quilltap health endpoint until the server is ready.
 */
export class HealthChecker {
  private healthUrl: string;

  constructor(healthUrl?: string) {
    this.healthUrl = healthUrl || HEALTH_URL;
  }
  /**
   * Poll the health endpoint until healthy or max attempts reached.
   * Accepts 'degraded' as good enough to proceed.
   */
  async waitForHealthy(
    maxAttempts: number = HEALTH_MAX_ATTEMPTS,
    intervalMs: number = HEALTH_POLL_INTERVAL_MS,
    onProgress?: (status: HealthStatus) => void
  ): Promise<HealthStatus> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const status = await this.checkHealth(attempt);

      if (onProgress) {
        onProgress(status);
      }

      if (status.status === 'healthy' || status.status === 'degraded' || status.status === 'locked') {
        return status;
      }

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }

    return {
      status: 'unreachable',
      attempts: maxAttempts,
      error: `Health check timed out after ${maxAttempts} attempts`,
    };
  }

  /** Single health check attempt */
  private checkHealth(attempt: number): Promise<HealthStatus> {
    return new Promise((resolve) => {
      const request = http.get(this.healthUrl, { timeout: 5000 }, (response) => {
        let body = '';

        response.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });

        response.on('end', () => {
          try {
            const data = JSON.parse(body);
            const status = data.status === 'healthy' ? 'healthy'
              : data.status === 'degraded' ? 'degraded'
              : data.status === 'locked' ? 'locked'
              : 'unhealthy';

            resolve({
              status,
              attempts: attempt,
              dbKeyState: data.status === 'locked' ? data.dbKeyState : undefined,
            });
          } catch {
            resolve({
              status: 'unhealthy',
              attempts: attempt,
              error: 'Invalid JSON response from health endpoint',
            });
          }
        });
      });

      request.on('error', () => {
        resolve({
          status: 'unreachable',
          attempts: attempt,
          error: 'Connection refused',
        });
      });

      request.on('timeout', () => {
        request.destroy();
        resolve({
          status: 'unreachable',
          attempts: attempt,
          error: 'Request timed out',
        });
      });
    });
  }
}
