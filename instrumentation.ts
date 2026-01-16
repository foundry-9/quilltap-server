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
    console.log('🚀 Server starting - initializing services');

    try {
      // Dynamically import everything to avoid Edge Runtime issues
      const { initializeMongoDBIfNeeded } = await import('./lib/startup');
      const { initializePlugins } = await import('./lib/startup/plugin-initialization');
      const { fileStorageManager } = await import('./lib/file-storage/manager');

      // Initialize MongoDB FIRST - this ensures the database is ready
      // before plugin initialization runs migrations
      const mongoResult = await initializeMongoDBIfNeeded();
      if (mongoResult.initialized) {
        console.log('✅ MongoDB initialized successfully');
      } else {
        console.log('ℹ️ MongoDB not enabled or not configured:', mongoResult.message);
      }

      // Initialize plugins (includes running migrations which now have MongoDB ready)
      const result = await initializePlugins();

      if (result.success) {
        console.log('✅ Plugin system initialized successfully', {
          total: result.stats.total,
          enabled: result.stats.enabled,
          disabled: result.stats.disabled,
          errors: result.stats.errors,
        });
      } else {
        console.error('❌ Plugin system initialization failed', {
          stats: result.stats,
          errors: result.errors,
        });
      }

      // Ensure file storage manager is initialized (may already be done by plugin init)
      if (!fileStorageManager.isInitialized()) {
        console.log('📁 Initializing file storage manager...');
        await fileStorageManager.initialize();
        console.log('✅ File storage manager initialized');
      }
    } catch (error) {
      console.error('❌ Fatal error initializing services:', error);
      // Don't throw - allow server to start even if initialization fails
    }
  }
}
