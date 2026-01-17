/**
 * Next.js Instrumentation
 *
 * This file is automatically run by Next.js on server startup.
 * We use it to initialize the plugin system before handling any requests.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run in Node.js runtime (not Edge Runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Use dynamic import for logger to avoid Edge Runtime issues
    const { logger } = await import('./lib/logger');
    const { startupState } = await import('./lib/startup/startup-state');

    logger.info('Server starting - initializing services', {
      context: 'instrumentation.register',
      runtime: process.env.NEXT_RUNTIME,
      nodeVersion: process.version,
    });

    try {
      // Dynamically import everything to avoid Edge Runtime issues
      const { initializeMongoDBIfNeeded } = await import('./lib/startup');
      const { initializePlugins } = await import('./lib/startup/plugin-initialization');
      const { fileStorageManager } = await import('./lib/file-storage/manager');

      // Mark startup as in progress
      startupState.setPhase('mongodb');

      // Initialize MongoDB FIRST - this ensures the database is ready
      // before plugin initialization runs migrations
      const mongoResult = await initializeMongoDBIfNeeded();
      if (mongoResult.initialized) {
        logger.info('MongoDB initialized successfully', {
          context: 'instrumentation.register',
          latencyMs: mongoResult.latencyMs,
        });
      } else {
        logger.info('MongoDB not enabled or not configured', {
          context: 'instrumentation.register',
          message: mongoResult.message,
        });
      }

      // Initialize plugins (includes running migrations which now have MongoDB ready)
      startupState.setPhase('plugins');
      const result = await initializePlugins();

      if (result.success) {
        logger.info('Plugin system initialized successfully', {
          context: 'instrumentation.register',
          total: result.stats.total,
          enabled: result.stats.enabled,
          disabled: result.stats.disabled,
          errors: result.stats.errors,
        });
      } else {
        logger.error('Plugin system initialization failed', {
          context: 'instrumentation.register',
          stats: result.stats,
          errors: result.errors,
        });
      }

      // Ensure file storage manager is initialized (may already be done by plugin init)
      startupState.setPhase('file-storage');
      if (!fileStorageManager.isInitialized()) {
        logger.info('Initializing file storage manager', {
          context: 'instrumentation.register',
        });
        await fileStorageManager.initialize();
        logger.info('File storage manager initialized', {
          context: 'instrumentation.register',
        });
      }

      // Mark startup as complete
      startupState.setPhase('complete');
      startupState.markReady();

      logger.info('All services initialized successfully', {
        context: 'instrumentation.register',
        migrationsComplete: startupState.areMigrationsComplete(),
      });
    } catch (error) {
      logger.error('Fatal error initializing services', {
        context: 'instrumentation.register',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      // Mark startup as failed but allow server to start
      startupState.setPhase('failed');
      // Don't throw - allow server to start even if initialization fails
    }
  }
}
