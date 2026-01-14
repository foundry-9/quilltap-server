/**
 * Plugins API v1 - Collection Endpoint
 *
 * GET /api/v1/plugins - List all registered plugins
 * GET /api/v1/plugins?filter=installed - List only installed plugins
 * POST /api/v1/plugins?action=search - Search npm registry for plugins
 * POST /api/v1/plugins?action=install - Install a plugin
 * POST /api/v1/plugins?action=uninstall - Uninstall a plugin
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { pluginRegistry } from '@/lib/plugins/registry';
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup/plugin-initialization';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, serverError, validationError } from '@/lib/api/responses';

// ============================================================================
// Schemas
// ============================================================================

const searchPluginsSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  type: z.enum(['provider', 'theme', 'tool', 'all']).optional().default('all'),
});

const installPluginSchema = z.object({
  packageName: z.string().min(1, 'Package name is required'),
  version: z.string().optional(),
});

const uninstallPluginSchema = z.object({
  packageName: z.string().min(1, 'Package name is required'),
});

type SearchPluginsInput = z.infer<typeof searchPluginsSchema>;
type InstallPluginInput = z.infer<typeof installPluginSchema>;
type UninstallPluginInput = z.infer<typeof uninstallPluginSchema>;

// ============================================================================
// Action Handlers
// ============================================================================

async function handleSearch(req: NextRequest, context: any) {
  try {
    const body = await req.json();
    const validatedData = searchPluginsSchema.parse(body);

    logger.debug('[Plugins v1] POST search', {
      userId: context.user.id,
      query: validatedData.query,
      type: validatedData.type,
    });

    // TODO: Implement npm registry search
    const results = [
      {
        name: 'example-plugin',
        packageName: '@quilltap/example-plugin',
        title: 'Example Plugin',
        description: 'An example plugin for demonstration',
        version: '1.0.0',
        type: 'tool',
        author: 'Quilltap Team',
        downloads: 1000,
      },
    ];

    logger.debug('[Plugins v1] Search results returned', {
      userId: context.user.id,
      resultCount: results.length,
    });

    return NextResponse.json({
      results,
      count: results.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.debug('[Plugins v1] Validation error on search', { errors: error.errors });
      return validationError(error);
    }

    logger.error(
      '[Plugins v1] Error searching plugins',
      { userId: context.user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to search plugins');
  }
}

async function handleInstall(req: NextRequest, context: any) {
  try {
    const body = await req.json();
    const validatedData = installPluginSchema.parse(body);

    logger.info('[Plugins v1] POST install', {
      userId: context.user.id,
      packageName: validatedData.packageName,
      version: validatedData.version,
    });

    // TODO: Implement plugin installation
    // This would involve:
    // 1. Downloading package from npm
    // 2. Validating manifest
    // 3. Installing to plugins directory
    // 4. Registering with plugin system

    const installed = {
      name: validatedData.packageName,
      title: 'Installed Plugin',
      version: validatedData.version || '1.0.0',
      enabled: true,
      installedAt: new Date().toISOString(),
    };

    logger.info('[Plugins v1] Plugin installed', {
      userId: context.user.id,
      packageName: validatedData.packageName,
    });

    return NextResponse.json({ plugin: installed }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.debug('[Plugins v1] Validation error on install', { errors: error.errors });
      return validationError(error);
    }

    logger.error(
      '[Plugins v1] Error installing plugin',
      { userId: context.user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to install plugin');
  }
}

async function handleUninstall(req: NextRequest, context: any) {
  try {
    const body = await req.json();
    const validatedData = uninstallPluginSchema.parse(body);

    logger.info('[Plugins v1] POST uninstall', {
      userId: context.user.id,
      packageName: validatedData.packageName,
    });

    // TODO: Implement plugin uninstallation
    // This would involve:
    // 1. Removing from plugins directory
    // 2. Unregistering from plugin system
    // 3. Cleaning up configuration

    logger.info('[Plugins v1] Plugin uninstalled', {
      userId: context.user.id,
      packageName: validatedData.packageName,
    });

    return NextResponse.json({
      success: true,
      message: 'Plugin uninstalled',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.debug('[Plugins v1] Validation error on uninstall', { errors: error.errors });
      return validationError(error);
    }

    logger.error(
      '[Plugins v1] Error uninstalling plugin',
      { userId: context.user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to uninstall plugin');
  }
}

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedHandler(async (req: NextRequest, { user, repos }) => {
  try {
    logger.debug('[Plugins v1] GET list', { userId: user.id });

    // Ensure plugins are initialized
    if (!isPluginSystemInitialized()) {
      logger.info('[Plugins v1] Plugin system not initialized, initializing now', {
        userId: user.id,
      });
      await initializePlugins();
    }

    const { searchParams } = new URL(req.url);
    const filter = searchParams.get('filter');

    const state = pluginRegistry.exportState();
    let plugins = state.plugins;

    // Apply filter
    if (filter === 'installed') {
      plugins = plugins.filter((p: any) => p.enabled);
      logger.debug('[Plugins v1] Filtered to installed plugins', {
        userId: user.id,
        count: plugins.length,
      });
    }

    return NextResponse.json({
      plugins,
      stats: state.stats,
      errors: state.errors,
      count: plugins.length,
    });
  } catch (error) {
    logger.error(
      '[Plugins v1] Error listing plugins',
      { userId: user.id },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to fetch plugins');
  }
});

// ============================================================================
// POST Handler
// ============================================================================

export const POST = createAuthenticatedHandler(async (req: NextRequest, context) => {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  logger.debug('[Plugins v1] POST request', { action, userId: context.user.id });

  switch (action) {
    case 'search':
      return handleSearch(req, context);
    case 'install':
      return handleInstall(req, context);
    case 'uninstall':
      return handleUninstall(req, context);
    default:
      return badRequest(
        `Unknown action: ${action}. Available actions: search, install, uninstall`
      );
  }
});
