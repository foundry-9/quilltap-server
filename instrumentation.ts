/**
 * Next.js Instrumentation
 *
 * This file is automatically run by Next.js on server startup.
 * We use it to:
 * 1. Run migrations FIRST - before any requests can be served
 * 2. Initialize the plugin system
 * 3. Initialize file storage
 *
 * CRITICAL: Migrations MUST complete successfully before the server accepts requests.
 * If migrations fail, the process exits with code 1 to prevent serving stale data.
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
      // ================================================================
      // PHASE 0: Migrate Legacy Data Files (before any database access)
      // ================================================================
      // This MUST happen before database initialization to copy the actual database
      const {
        ensureDataDirectoriesExist,
        getPlatform,
        getBaseDataDir,
        getDataDir,
        getFilesDir,
        getLegacyPaths,
        hasMigrationMarker,
        createMigrationMarker,
      } = await import('./lib/paths');
      const fs = await import('fs');
      const path = await import('path');

      const platform = getPlatform();
      const baseDir = getBaseDataDir();

      logger.info('Phase 0: Ensuring data directories exist', {
        context: 'instrumentation.register',
        platform,
        baseDir,
      });

      // Create directories first
      ensureDataDirectoriesExist();

      // On macOS/Windows, check if we need to copy legacy data BEFORE database init
      if (platform === 'darwin' || platform === 'win32') {
        const legacy = getLegacyPaths();
        const newDataDir = getDataDir();
        const newFilesDir = getFilesDir();
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';
        const legacyBase = path.default.join(homeDir, '.quilltap');

        // Only migrate if paths are different
        if (path.default.resolve(baseDir) !== path.default.resolve(legacyBase)) {
          // Check for legacy database at ~/.quilltap/data/quilltap.db
          const legacyDbPath = path.default.join(legacy.homeDataDir, 'quilltap.db');
          const newDbPath = path.default.join(newDataDir, 'quilltap.db');

          if (fs.default.existsSync(legacyDbPath) && !hasMigrationMarker(legacy.homeDataDir)) {
            // Check if new database doesn't exist OR is much smaller (empty)
            let shouldCopy = !fs.default.existsSync(newDbPath);
            if (!shouldCopy) {
              const legacySize = fs.default.statSync(legacyDbPath).size;
              const newSize = fs.default.statSync(newDbPath).size;
              // If new file is less than 10% the size of old, it's probably empty
              shouldCopy = newSize < legacySize * 0.1;
            }

            if (shouldCopy) {
              logger.info('Copying legacy database to new location', {
                context: 'instrumentation.register',
                from: legacyDbPath,
                to: newDbPath,
              });

              try {
                fs.default.copyFileSync(legacyDbPath, newDbPath);
                // Also copy WAL files if they exist
                const walPath = legacyDbPath + '-wal';
                const shmPath = legacyDbPath + '-shm';
                if (fs.default.existsSync(walPath)) {
                  fs.default.copyFileSync(walPath, newDbPath + '-wal');
                }
                if (fs.default.existsSync(shmPath)) {
                  fs.default.copyFileSync(shmPath, newDbPath + '-shm');
                }
                createMigrationMarker(legacy.homeDataDir, newDataDir);
                logger.info('Legacy database copied successfully', {
                  context: 'instrumentation.register',
                });
              } catch (err) {
                logger.error('Failed to copy legacy database', {
                  context: 'instrumentation.register',
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
          }

          // Check for legacy files at ~/.quilltap/files
          if (fs.default.existsSync(legacy.filesDir) && !hasMigrationMarker(legacy.filesDir)) {
            const files = fs.default.readdirSync(legacy.filesDir);
            if (files.length > 0 && files.some(f => f !== '.MIGRATED')) {
              logger.info('Copying legacy files to new location', {
                context: 'instrumentation.register',
                from: legacy.filesDir,
                to: newFilesDir,
              });

              try {
                // Copy files recursively
                const copyRecursive = (src: string, dest: string) => {
                  const entries = fs.default.readdirSync(src, { withFileTypes: true });
                  for (const entry of entries) {
                    if (entry.name === '.MIGRATED') continue;
                    const srcPath = path.default.join(src, entry.name);
                    const destPath = path.default.join(dest, entry.name);
                    if (entry.isDirectory()) {
                      if (!fs.default.existsSync(destPath)) {
                        fs.default.mkdirSync(destPath, { recursive: true });
                      }
                      copyRecursive(srcPath, destPath);
                    } else if (!fs.default.existsSync(destPath)) {
                      fs.default.copyFileSync(srcPath, destPath);
                    }
                  }
                };
                copyRecursive(legacy.filesDir, newFilesDir);
                createMigrationMarker(legacy.filesDir, newFilesDir);
                logger.info('Legacy files copied successfully', {
                  context: 'instrumentation.register',
                });
              } catch (err) {
                logger.error('Failed to copy legacy files', {
                  context: 'instrumentation.register',
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
          }
        }
      }

      // ================================================================
      // PHASE 1: Run Migrations FIRST - before anything else
      // ================================================================
      // This ensures data compatibility before any API requests
      startupState.setPhase('migrations');

      const { MigrationRunner } = await import('./migrations');
      const migrationRunner = new MigrationRunner();

      logger.info('Running startup migrations', {
        context: 'instrumentation.register',
      });

      const migrationResult = await migrationRunner.runMigrations();

      if (!migrationResult.success) {
        logger.error('Migrations failed - cannot start server', {
          context: 'instrumentation.register',
          failedMigrations: migrationResult.failed,
          error: migrationResult.error,
          migrationsRun: migrationResult.migrationsRun,
          migrationsSkipped: migrationResult.migrationsSkipped,
        });
        // Exit with code 1 to prevent container from starting with incompatible data
        process.exit(1);
      }

      logger.info('Migrations completed successfully', {
        context: 'instrumentation.register',
        migrationsRun: migrationResult.migrationsRun,
        migrationsSkipped: migrationResult.migrationsSkipped,
        totalDurationMs: migrationResult.totalDurationMs,
      });

      // Mark migrations as complete
      startupState.markMigrationsComplete();

      // Clean up migration runner's database connection
      await migrationRunner.cleanup();

      // ================================================================
      // PHASE 2: Initialize Plugins (MongoDB support removed)
      // ================================================================
      const { initializePlugins } = await import('./lib/startup/plugin-initialization');
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

      // ================================================================
      // PHASE 3: Initialize File Storage
      // ================================================================
      const { fileStorageManager } = await import('./lib/file-storage/manager');
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

      // ================================================================
      // PHASE 4: Mark startup complete
      // ================================================================
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
