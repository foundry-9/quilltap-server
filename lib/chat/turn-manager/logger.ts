/**
 * Turn Manager Logger
 *
 * Provides a conditional logger that works in both client and server contexts.
 * The server-side logger imports 'fs' which causes issues on the client.
 */

const isClient = typeof window !== 'undefined';

/**
 * Logger interface that works in both client and server environments
 */
export const turnManagerLogger = {
  debug: (message: string, data?: Record<string, unknown>) => {
    if (isClient) {
      console.debug(`[Turn Manager] ${message}`, data);
    } else {
      // Dynamic import for server-side logger to avoid client bundling issues
      import('@/lib/logger').then(mod => mod.logger.debug(message, data));
    }
  },
  warn: (message: string, data?: Record<string, unknown>) => {
    if (isClient) {
      console.warn(`[Turn Manager] ${message}`, data);
    } else {
      import('@/lib/logger').then(mod => mod.logger.warn(message, data));
    }
  },
};
