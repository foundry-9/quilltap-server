/**
 * Migration: Migrate Site Plugins to Data Directory
 *
 * This migration moves plugins from the application-relative site plugins directory
 * (plugins/site/) to the data directory ($QUILLTAP_DATA_DIR/plugins/npm/).
 *
 * Background:
 * Prior to this migration, npm-installed plugins were stored in the application
 * directory at plugins/site/. This caused issues with:
 * - Docker deployments where the app directory is read-only
 * - App updates that would overwrite the plugins directory
 * - Separation of concerns between app code and user data
 *
 * The new location in the data directory ensures plugins persist across app updates
 * and are properly separated from the application code.
 *
 * Migration ID: migrate-site-plugins-to-data-dir-v1
 */

import type { Migration, MigrationResult } from '../types';
import { logger } from '../lib/logger';
import fs from 'fs';
import path from 'path';
import { getNpmPluginsDir } from '@/lib/paths';

const PLUGINS_BASE_DIR = path.join(process.cwd(), 'plugins');
const OLD_PLUGINS_SITE_DIR = path.join(PLUGINS_BASE_DIR, 'site');

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
            context: 'migration.site-plugins-to-data-dir',
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
 * Migrate Site Plugins to Data Directory Migration
 */
export const migrateSitePluginsToDataDirMigration: Migration = {
  id: 'migrate-site-plugins-to-data-dir-v1',
  description: 'Migrate site plugins from app directory to data directory',
  introducedInVersion: '2.9.0',
  // Depends on previous migration that moved user plugins to site
  dependsOn: ['migrate-user-plugins-to-site-v1'],

  async shouldRun(): Promise<boolean> {
    // Check if old site plugins directory exists and has any plugin directories
    if (!fs.existsSync(OLD_PLUGINS_SITE_DIR)) {
      logger.info('No old site plugins directory found, skipping migration', {
        context: 'migration.site-plugins-to-data-dir',
        oldDir: OLD_PLUGINS_SITE_DIR,
      });
      return false;
    }

    try {
      const entries = fs.readdirSync(OLD_PLUGINS_SITE_DIR, { withFileTypes: true });

      // Check if there are any plugin directories
      for (const entry of entries) {
        if (entry.isDirectory() && isPluginDirectoryName(entry.name)) {
          logger.info('Found site plugins that need migration to data directory', {
            context: 'migration.site-plugins-to-data-dir',
            pluginDir: entry.name,
          });
          return true;
        }
      }

      logger.info('No site plugins found to migrate', {
        context: 'migration.site-plugins-to-data-dir',
      });
      return false;
    } catch (error) {
      logger.warn('Error checking for site plugins', {
        context: 'migration.site-plugins-to-data-dir',
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  },

  async run(): Promise<MigrationResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let pluginsMigrated = 0;

    const newPluginsDir = getNpmPluginsDir();

    logger.info('Starting site plugins to data directory migration', {
      context: 'migration.site-plugins-to-data-dir',
      oldDir: OLD_PLUGINS_SITE_DIR,
      newDir: newPluginsDir,
    });

    // Ensure new plugins directory exists
    if (!fs.existsSync(newPluginsDir)) {
      fs.mkdirSync(newPluginsDir, { recursive: true });
    }

    // Load existing registry from new location to merge into
    const newRegistry = loadRegistry(newPluginsDir);
    // Load old registry for metadata
    const oldRegistry = loadRegistry(OLD_PLUGINS_SITE_DIR);

    try {
      const entries = fs.readdirSync(OLD_PLUGINS_SITE_DIR, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!isPluginDirectoryName(entry.name)) continue;

        const sourcePluginDir = path.join(OLD_PLUGINS_SITE_DIR, entry.name);
        const targetPluginDir = path.join(newPluginsDir, entry.name);

        // Skip if already exists in new location
        if (fs.existsSync(targetPluginDir)) {
          logger.info('Plugin already exists in data directory, skipping', {
            context: 'migration.site-plugins-to-data-dir',
            plugin: entry.name,
          });
          continue;
        }

        logger.info('Migrating site plugin to data directory', {
          context: 'migration.site-plugins-to-data-dir',
          plugin: entry.name,
          from: sourcePluginDir,
          to: targetPluginDir,
        });

        // Copy the plugin directory
        const copyResult = copyDirectoryRecursive(sourcePluginDir, targetPluginDir);
        if (copyResult.success) {
          pluginsMigrated++;

          // Find and migrate registry entry
          const registryEntry = oldRegistry.plugins.find(p =>
            p.name === entry.name ||
            p.name.replace('/', '--') === entry.name
          );

          if (registryEntry) {
            // Add to new registry if not already present
            const existingEntry = newRegistry.plugins.find(p => p.name === registryEntry.name);
            if (!existingEntry) {
              newRegistry.plugins.push(registryEntry);
            }
          }

          logger.info('Plugin migrated successfully', {
            context: 'migration.site-plugins-to-data-dir',
            plugin: entry.name,
            filesCopied: copyResult.filesCopied,
          });
        } else {
          errors.push(`Failed to migrate ${entry.name}: ${copyResult.error}`);
          logger.error('Failed to migrate plugin', {
            context: 'migration.site-plugins-to-data-dir',
            plugin: entry.name,
            error: copyResult.error,
          });
        }
      }

      // Save updated registry
      if (pluginsMigrated > 0) {
        saveRegistry(newPluginsDir, newRegistry);
      }

      // Leave a marker file in the old directory
      if (pluginsMigrated > 0) {
        const markerPath = path.join(OLD_PLUGINS_SITE_DIR, '.MIGRATED');
        const markerContent = `Plugins migrated to: ${newPluginsDir}\nMigrated at: ${new Date().toISOString()}\nPlugins migrated: ${pluginsMigrated}\n`;
        fs.writeFileSync(markerPath, markerContent);
      }

      logger.info('Migration complete, old site plugins directory preserved with marker', {
        context: 'migration.site-plugins-to-data-dir',
        oldDir: OLD_PLUGINS_SITE_DIR,
        newDir: newPluginsDir,
      });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push(`Migration failed: ${errorMsg}`);
      logger.error('Site plugins to data directory migration failed', {
        context: 'migration.site-plugins-to-data-dir',
        error: errorMsg,
      });
    }

    const success = errors.length === 0;
    const durationMs = Date.now() - startTime;

    logger.info('Site plugins to data directory migration completed', {
      context: 'migration.site-plugins-to-data-dir',
      success,
      pluginsMigrated,
      errorCount: errors.length,
      durationMs,
    });

    return {
      id: 'migrate-site-plugins-to-data-dir-v1',
      success,
      itemsAffected: pluginsMigrated,
      message: success
        ? `Migrated ${pluginsMigrated} site plugin(s) to data directory`
        : `Migration completed with ${errors.length} error(s)`,
      error: errors.length > 0 ? errors.join('; ') : undefined,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  },
};
