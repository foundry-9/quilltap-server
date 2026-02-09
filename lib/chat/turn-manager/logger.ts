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
      // Debug logs are silent on the client side (too noisy for console)
    } else {
      // Debug logging disabled
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
