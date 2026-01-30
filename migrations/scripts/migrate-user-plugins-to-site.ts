/**
 * Migration: Migrate User Plugins to Site Plugins
 *
 * This migration moves plugins from the per-user plugins directory (plugins/users/[user-id]/)
 * to the site-wide plugins directory (plugins/site/).
 *
 * Background:
 * Prior to this migration, Quilltap supported two plugin installation scopes:
 * - site: plugins/site/ (shared by all users)
 * - user: plugins/users/[user-id]/ (per-user plugins)
 *
 * Since Quilltap now operates in single-user mode, the per-user plugin directory
 * is no longer supported. This migration consolidates all user-installed plugins
 * into the site plugins directory.
 *
 * Migration ID: migrate-user-plugins-to-site-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import fs from 'fs';
import path from 'path';

const PLUGINS_BASE_DIR = path.join(process.cwd(), 'plugins');
const PLUGINS_SITE_DIR = path.join(PLUGINS_BASE_DIR, 'site');
const PLUGINS_USERS_DIR = path.join(PLUGINS_BASE_DIR, 'users');

interface PluginRegistryEntry {
  name: string;
  version: string;
  installedAt: string;
  source: 'npm' | 'local';
}

interface PluginRegistry {
  plugins: PluginRegistryEntry[];
}

/**
 * Copy a directory recursively
 */
function copyDirectoryRecursive(source: string, target: string): { success: boolean; filesCopied: number; error?: string } {
  let filesCopied = 0;

  try {
    // Ensure target directory exists
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }

    const entries = fs.readdirSync(source, { withFileTypes: true });

    for (const entry of entries) {
      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);

      if (entry.isDirectory()) {
        const result = copyDirectoryRecursive(sourcePath, targetPath);
        if (!result.success) {
          return result;
        }
        filesCopied += result.filesCopied;
      } else {
        // Skip if target already exists
        if (fs.existsSync(targetPath)) {
          logger.info('Skipping existing file', {
            context: 'migration.user-plugins-to-site',
            file: targetPath,
          });
          continue;
        }

        fs.copyFileSync(sourcePath, targetPath);
        filesCopied++;
      }
    }

    return { success: true, filesCopied };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, filesCopied, error: errorMessage };
  }
}

/**
 * Check if a directory name is a valid plugin directory
 */
function isPluginDirectoryName(dirName: string): boolean {
  // Unscoped: qtap-plugin-*
  if (dirName.startsWith('qtap-plugin-')) return true;
  // Scoped (converted): @org--qtap-plugin-*
  if (dirName.startsWith('@') && dirName.includes('--qtap-plugin-')) return true;
  return false;
}

/**
 * Load registry from a directory
 */
function loadRegistry(dir: string): PluginRegistry {
  const registryPath = path.join(dir, 'registry.json');
  try {
    if (fs.existsSync(registryPath)) {
      const content = fs.readFileSync(registryPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Registry doesn't exist or is invalid
  }
  return { plugins: [] };
}

/**
 * Save registry to a directory
 */
function saveRegistry(dir: string, registry: PluginRegistry): void {
  const registryPath = path.join(dir, 'registry.json');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
}

/**
 * Migrate User Plugins to Site Plugins Migration
 */
export const migrateUserPluginsToSiteMigration: Migration = {
  id: 'migrate-user-plugins-to-site-v1',
  description: 'Migrate per-user plugins to site-wide plugins directory (single-user mode)',
  introducedInVersion: '2.9.0',
  // No dependencies - this can run independently

  async shouldRun(): Promise<boolean> {
    // Check if user plugins directory exists and has any user subdirectories with plugins
    if (!fs.existsSync(PLUGINS_USERS_DIR)) {
      logger.info('No user plugins directory found, skipping migration', {
        context: 'migration.user-plugins-to-site',
      });
      return false;
    }

    try {
      const userDirs = fs.readdirSync(PLUGINS_USERS_DIR, { withFileTypes: true });

      for (const userDir of userDirs) {
        if (!userDir.isDirectory()) continue;

        const userPluginsPath = path.join(PLUGINS_USERS_DIR, userDir.name);
        const entries = fs.readdirSync(userPluginsPath, { withFileTypes: true });

        // Check if there are any plugin directories
        for (const entry of entries) {
          if (entry.isDirectory() && isPluginDirectoryName(entry.name)) {
            logger.info('Found user plugins that need migration', {
              context: 'migration.user-plugins-to-site',
              userId: userDir.name,
              pluginDir: entry.name,
            });
            return true;
          }
        }
      }

      logger.info('No user plugins found to migrate', {
        context: 'migration.user-plugins-to-site',
      });
      return false;
    } catch (error) {
      logger.warn('Error checking for user plugins', {
        context: 'migration.user-plugins-to-site',
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let pluginsMigrated = 0;

    logger.info('Starting user plugins to site migration', {
      context: 'migration.user-plugins-to-site',
      usersDir: PLUGINS_USERS_DIR,
      siteDir: PLUGINS_SITE_DIR,
    });

    // Ensure site plugins directory exists
    if (!fs.existsSync(PLUGINS_SITE_DIR)) {
      fs.mkdirSync(PLUGINS_SITE_DIR, { recursive: true });
    }

    // Load site registry to merge user plugins into
    const siteRegistry = loadRegistry(PLUGINS_SITE_DIR);

    try {
      const userDirs = fs.readdirSync(PLUGINS_USERS_DIR, { withFileTypes: true });

      for (const userDir of userDirs) {
        if (!userDir.isDirectory()) continue;

        const userPluginsPath = path.join(PLUGINS_USERS_DIR, userDir.name);
        const entries = fs.readdirSync(userPluginsPath, { withFileTypes: true });

        // Load user's registry to get installation metadata
        const userRegistry = loadRegistry(userPluginsPath);

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (!isPluginDirectoryName(entry.name)) continue;

          const sourcePluginDir = path.join(userPluginsPath, entry.name);
          const targetPluginDir = path.join(PLUGINS_SITE_DIR, entry.name);

          // Skip if already exists in site plugins
          if (fs.existsSync(targetPluginDir)) {
            logger.info('Plugin already exists in site directory, skipping', {
              context: 'migration.user-plugins-to-site',
              plugin: entry.name,
              userId: userDir.name,
            });
            continue;
          }

          logger.info('Migrating user plugin to site', {
            context: 'migration.user-plugins-to-site',
            plugin: entry.name,
            userId: userDir.name,
            from: sourcePluginDir,
            to: targetPluginDir,
          });

          // Copy the plugin directory
          const copyResult = copyDirectoryRecursive(sourcePluginDir, targetPluginDir);
          if (copyResult.success) {
            pluginsMigrated++;

            // Find and migrate registry entry
            const registryEntry = userRegistry.plugins.find(p =>
              p.name === entry.name ||
              p.name.replace('/', '--') === entry.name
            );

            if (registryEntry) {
              // Add to site registry if not already present
              const existingEntry = siteRegistry.plugins.find(p => p.name === registryEntry.name);
              if (!existingEntry) {
                siteRegistry.plugins.push(registryEntry);
              }
            }

            logger.info('Plugin migrated successfully', {
              context: 'migration.user-plugins-to-site',
              plugin: entry.name,
              filesCopied: copyResult.filesCopied,
            });
          } else {
            errors.push(`Failed to migrate ${entry.name}: ${copyResult.error}`);
            logger.error('Failed to migrate plugin', {
              context: 'migration.user-plugins-to-site',
              plugin: entry.name,
              error: copyResult.error,
            });
          }
        }
      }

      // Save updated site registry
      if (pluginsMigrated > 0) {
        saveRegistry(PLUGINS_SITE_DIR, siteRegistry);
      }

      // Clean up empty user plugin directories (but keep files like registry.json for reference)
      // We don't delete the users directory itself in case someone wants to reference it later
      logger.info('Migration complete, user plugins directory preserved for reference', {
        context: 'migration.user-plugins-to-site',
        usersDir: PLUGINS_USERS_DIR,
      });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push(`Migration failed: ${errorMsg}`);
      logger.error('User plugins migration failed', {
        context: 'migration.user-plugins-to-site',
        error: errorMsg,
      });
    }

    const success = errors.length === 0;
    const durationMs = Date.now() - startTime;

    logger.info('User plugins to site migration completed', {
      context: 'migration.user-plugins-to-site',
      success,
      pluginsMigrated,
      errorCount: errors.length,
      durationMs,
    });

    return {
      id: 'migrate-user-plugins-to-site-v1',
      success,
      itemsAffected: pluginsMigrated,
      message: success
        ? `Migrated ${pluginsMigrated} user plugin(s) to site directory`
        : `Migration completed with ${errors.length} error(s)`,
      error: errors.length > 0 ? errors.join('; ') : undefined,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
