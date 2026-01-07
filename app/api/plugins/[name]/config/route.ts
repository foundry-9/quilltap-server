/**
 * Plugin Configuration API
 *
 * GET /api/plugins/[name]/config - Get plugin configuration for current user
 * PUT /api/plugins/[name]/config - Update plugin configuration for current user
 */

import { NextResponse } from 'next/server';
import { createAuthenticatedParamsHandler } from '@/lib/api/middleware';
import { pluginRegistry } from '@/lib/plugins/registry';
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup/plugin-initialization';
import { logger } from '@/lib/logger';
import { z } from 'zod';

const configLogger = logger.child({ module: 'plugin-config-api' });

/**
 * GET /api/plugins/[name]/config
 * Get plugin configuration for the current user
 */
export const GET = createAuthenticatedParamsHandler<{ name: string }>(
  async (req, { user, repos }, { name }) => {
    try {
      // Ensure plugins are initialized
      if (!isPluginSystemInitialized()) {
        configLogger.info('Plugin system not initialized, initializing now', {
          context: 'plugins-config-GET',
        });
        await initializePlugins();
      }

      // Check if plugin exists
      if (!pluginRegistry.has(name)) {
        configLogger.debug('Plugin not found for config request', { pluginName: name });
        return NextResponse.json(
          { error: 'Plugin not found' },
          { status: 404 }
        );
      }

      const plugin = pluginRegistry.get(name);
      if (!plugin) {
        return NextResponse.json(
          { error: 'Plugin not found' },
          { status: 404 }
        );
      }

      // Get the config schema from the manifest
      const configSchema = plugin.manifest.configSchema || [];

      // Get user's current configuration
      const userConfig = await repos.pluginConfigs.findByUserAndPlugin(user.id, name);

      // Build default config from schema
      const defaultConfig: Record<string, unknown> = {};
      for (const field of configSchema) {
        if (field.default !== undefined) {
          defaultConfig[field.key] = field.default;
        }
      }

      // Merge default config with user config
      const effectiveConfig = {
        ...defaultConfig,
        ...(userConfig?.config || {}),
      };

      configLogger.debug('Retrieved plugin config', {
        pluginName: name,
        userId: user.id,
        hasUserConfig: !!userConfig,
        fieldCount: Object.keys(effectiveConfig).length,
      });

      return NextResponse.json({
        pluginName: name,
        pluginTitle: plugin.manifest.title,
        configSchema,
        config: effectiveConfig,
        hasUserConfig: !!userConfig,
      });
    } catch (error) {
      configLogger.error('Failed to get plugin config', {
        pluginName: name,
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: 'Failed to get plugin configuration' },
        { status: 500 }
      );
    }
  }
);

/**
 * Schema for config update request
 */
const ConfigUpdateSchema = z.object({
  config: z.record(z.unknown()),
});

/**
 * PUT /api/plugins/[name]/config
 * Update plugin configuration for the current user
 */
export const PUT = createAuthenticatedParamsHandler<{ name: string }>(
  async (req, { user, repos }, { name }) => {
    try {
      // Ensure plugins are initialized
      if (!isPluginSystemInitialized()) {
        configLogger.info('Plugin system not initialized, initializing now', {
          context: 'plugins-config-PUT',
        });
        await initializePlugins();
      }

      // Check if plugin exists
      if (!pluginRegistry.has(name)) {
        configLogger.debug('Plugin not found for config update', { pluginName: name });
        return NextResponse.json(
          { error: 'Plugin not found' },
          { status: 404 }
        );
      }

      const plugin = pluginRegistry.get(name);
      if (!plugin) {
        return NextResponse.json(
          { error: 'Plugin not found' },
          { status: 404 }
        );
      }

      // Parse request body
      const body = await req.json();
      const parseResult = ConfigUpdateSchema.safeParse(body);

      if (!parseResult.success) {
        configLogger.debug('Invalid config update request', {
          pluginName: name,
          errors: parseResult.error.errors,
        });
        return NextResponse.json(
          { error: 'Invalid request body', details: parseResult.error.errors },
          { status: 400 }
        );
      }

      const { config } = parseResult.data;

      // Validate config against schema
      const configSchema = plugin.manifest.configSchema || [];
      const validatedConfig: Record<string, unknown> = {};
      const errors: string[] = [];

      for (const field of configSchema) {
        const value = config[field.key];

        // Apply default if not provided
        if (value === undefined || value === null) {
          if (field.default !== undefined) {
            validatedConfig[field.key] = field.default;
          }
          continue;
        }

        // Type validation based on field type
        // Valid types: 'text', 'number', 'boolean', 'select', 'textarea', 'password', 'url', 'email'
        switch (field.type) {
          case 'text':
          case 'textarea':
          case 'password':
          case 'url':
          case 'email':
            if (typeof value !== 'string') {
              errors.push(`${field.key}: expected string`);
            } else {
              validatedConfig[field.key] = value;
            }
            break;

          case 'number':
            if (typeof value !== 'number') {
              errors.push(`${field.key}: expected number`);
            } else {
              // Check min/max bounds
              if (field.min !== undefined && value < field.min) {
                errors.push(`${field.key}: value must be at least ${field.min}`);
              } else if (field.max !== undefined && value > field.max) {
                errors.push(`${field.key}: value must be at most ${field.max}`);
              } else {
                validatedConfig[field.key] = value;
              }
            }
            break;

          case 'boolean':
            if (typeof value !== 'boolean') {
              errors.push(`${field.key}: expected boolean`);
            } else {
              validatedConfig[field.key] = value;
            }
            break;

          case 'select':
            // Validate against options if provided
            if (field.options && Array.isArray(field.options)) {
              const validValues = field.options.map((o: any) =>
                typeof o === 'object' ? o.value : o
              );
              if (!validValues.includes(value)) {
                errors.push(`${field.key}: invalid option`);
              } else {
                validatedConfig[field.key] = value;
              }
            } else {
              validatedConfig[field.key] = value;
            }
            break;

          default:
            // Accept any value for unknown types
            validatedConfig[field.key] = value;
        }
      }

      if (errors.length > 0) {
        configLogger.debug('Config validation failed', {
          pluginName: name,
          errors,
        });
        return NextResponse.json(
          { error: 'Validation failed', details: errors },
          { status: 400 }
        );
      }

      // Upsert the configuration
      const updatedConfig = await repos.pluginConfigs.upsertForUserPlugin(
        user.id,
        name,
        validatedConfig
      );

      configLogger.info('Plugin config updated', {
        pluginName: name,
        userId: user.id,
        configId: updatedConfig.id,
        fieldCount: Object.keys(validatedConfig).length,
      });

      return NextResponse.json({
        success: true,
        pluginName: name,
        config: updatedConfig.config,
      });
    } catch (error) {
      configLogger.error('Failed to update plugin config', {
        pluginName: name,
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: 'Failed to update plugin configuration' },
        { status: 500 }
      );
    }
  }
);
