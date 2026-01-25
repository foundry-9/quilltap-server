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
import { initializePlugins } from '@/lib/startup/plugin-initialization';
import { installPluginFromNpm, uninstallPlugin, type PluginScope } from '@/lib/plugins/installer';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, serverError, validationError } from '@/lib/api/responses';

// ============================================================================
// Schemas
// ============================================================================

const searchPluginsSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  type: z.enum(['provider', 'theme', 'tool', 'all']).optional().prefault('all'),
});

const installPluginSchema = z.object({
  packageName: z.string().min(1, 'Package name is required'),
  version: z.string().optional(),
  scope: z.enum(['site', 'user']).optional().prefault('user'),
});

const uninstallPluginSchema = z.object({
  packageName: z.string().min(1, 'Package name is required'),
  scope: z.enum(['site', 'user']).optional().prefault('user'),
});

type SearchPluginsInput = z.infer<typeof searchPluginsSchema>;
type InstallPluginInput = z.infer<typeof installPluginSchema>;
type UninstallPluginInput = z.infer<typeof uninstallPluginSchema>;

// ============================================================================
// Action Handlers
// ============================================================================

/**
 * Check if a package name is a valid Quilltap plugin
 */
function isQuilltapPlugin(name: string): boolean {
  if (name.startsWith('qtap-plugin-')) return true;
  if (name.startsWith('@') && name.includes('/qtap-plugin-')) return true;
  return false;
}

/**
 * Perform npm registry search
 */
async function searchNpm(searchText: string): Promise<any[]> {
  const searchUrl = new URL('https://registry.npmjs.org/-/v1/search');
  searchUrl.searchParams.set('text', searchText);
  searchUrl.searchParams.set('size', '50');

  const response = await fetch(searchUrl.toString(), {
    headers: { 'Accept': 'application/json' },
    next: { revalidate: 300 }, // Cache for 5 minutes
  });

  if (!response.ok) {
    logger.warn('[Plugins v1] npm search request failed', {
      searchText,
      status: response.status,
    });
    return [];
  }

  const data = await response.json();
  return data.objects || [];
}

async function handleSearch(req: NextRequest, context: any) {
  try {
    const body = await req.json();
    const validatedData = searchPluginsSchema.parse(body);

    logger.debug('[Plugins v1] POST search', {
      userId: context.user.id,
      query: validatedData.query,
      type: validatedData.type,
    });

    // Perform multiple searches to find both scoped and unscoped plugins
    const query = validatedData.query.trim();
    const searchQueries = query
      ? [
          `qtap-plugin-${query}`,
          `@quilltap/ ${query}`,
        ]
      : [
          '@quilltap/',
          'qtap-plugin-',
        ];

    // Run searches in parallel
    const searchPromises = searchQueries.map(q => searchNpm(q));
    const results = await Promise.all(searchPromises);

    // Combine and deduplicate results
    const allObjects = results.flat();
    const seenNames = new Set<string>();
    const uniqueObjects = allObjects.filter(obj => {
      const name = obj.package?.name;
      if (!name || seenNames.has(name)) return false;
      seenNames.add(name);
      return true;
    });

    // Filter to only qtap-plugin-* packages and transform results
    const plugins = uniqueObjects
      .filter((obj: any) => obj.package?.name && isQuilltapPlugin(obj.package.name))
      .map((obj: any) => ({
        name: obj.package.name,
        version: obj.package.version,
        description: obj.package.description || 'No description available',
        author: typeof obj.package.author === 'string'
          ? obj.package.author
          : obj.package.author?.name || obj.package.publisher?.username || 'Unknown',
        keywords: obj.package.keywords || [],
        updated: obj.package.date || '',
        score: obj.score?.final || 0,
        links: obj.package.links,
      }));

    logger.debug('[Plugins v1] Search results returned', {
      userId: context.user.id,
      resultCount: plugins.length,
    });

    return NextResponse.json({
      results: plugins,
      count: plugins.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.debug('[Plugins v1] Validation error on search', { errors: error.issues });
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
      scope: validatedData.scope,
    });

    // Call the actual install function
    const result = await installPluginFromNpm(
      validatedData.packageName,
      validatedData.scope as PluginScope,
      validatedData.scope === 'user' ? context.user.id : undefined
    );

    if (!result.success) {
      logger.warn('[Plugins v1] Plugin install failed', {
        userId: context.user.id,
        packageName: validatedData.packageName,
        error: result.error,
      });
      return badRequest(result.error || 'Failed to install plugin');
    }

    logger.info('[Plugins v1] Plugin installed successfully', {
      userId: context.user.id,
      packageName: validatedData.packageName,
      scope: validatedData.scope,
    });

    // Reinitialize plugin system to reflect changes
    await initializePlugins();

    return NextResponse.json(
      {
        success: true,
        message: 'Plugin installed successfully',
        plugin: {
          name: result.manifest?.name,
          version: result.version,
          manifest: result.manifest,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.debug('[Plugins v1] Validation error on install', { errors: error.issues });
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
      scope: validatedData.scope,
    });

    // Call the actual uninstall function
    const result = await uninstallPlugin(
      validatedData.packageName,
      validatedData.scope as PluginScope,
      validatedData.scope === 'user' ? context.user.id : undefined
    );

    if (!result.success) {
      logger.warn('[Plugins v1] Plugin uninstall failed', {
        userId: context.user.id,
        packageName: validatedData.packageName,
        error: result.error,
      });
      return badRequest(result.error || 'Failed to uninstall plugin');
    }

    logger.info('[Plugins v1] Plugin uninstalled successfully', {
      userId: context.user.id,
      packageName: validatedData.packageName,
      scope: validatedData.scope,
    });

    // Reinitialize plugin system to reflect changes
    await initializePlugins();

    return NextResponse.json({
      success: true,
      message: 'Plugin uninstalled successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.debug('[Plugins v1] Validation error on uninstall', { errors: error.issues });
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

    // Ensure plugin system is initialized before accessing registry
    // This handles cases where the API is called before startup initialization completes
    // or when hot-reloading resets module state in development
    if (!pluginRegistry.isInitialized()) {
      logger.debug('[Plugins v1] Plugin registry not initialized, initializing now');
      await initializePlugins();
    }

    const { searchParams } = new URL(req.url);
    const filter = searchParams.get('filter');

    // Get site/bundled plugins from registry
    const state = pluginRegistry.exportState();
    const plugins = [...state.plugins];

    // Also scan user-specific plugins
    const { scanPlugins } = await import('@/lib/plugins/manifest-loader');
    const userScanResult = await scanPlugins(undefined, user.id);
    
    // Add user plugins to the list (filter to only user-scoped ones to avoid duplicates)
    const userPlugins = userScanResult.plugins
      .filter(plugin => plugin.pluginPath.includes(`plugins/users/${user.id}`))
      .map(plugin => ({
        name: plugin.manifest.name,
        title: plugin.manifest.title,
        version: plugin.packageVersion ?? plugin.manifest.version,
        enabled: plugin.enabled,
        capabilities: plugin.capabilities,
        path: plugin.pluginPath,
        source: plugin.source,
        scope: 'user' as const,
        packageName: plugin.packageName,
        hasConfigSchema: Array.isArray(plugin.manifest.configSchema) && plugin.manifest.configSchema.length > 0,
      }));
    
    const allPlugins = [...plugins, ...userPlugins];

    // Apply filter
    let filteredPlugins = allPlugins;
    if (filter === 'installed') {
      filteredPlugins = allPlugins.filter((p: any) => p.enabled);
      logger.debug('[Plugins v1] Filtered to installed plugins', {
        userId: user.id,
        count: filteredPlugins.length,
      });
    }

    // Calculate stats including user plugins
    const totalPlugins = allPlugins.length;
    const enabledPlugins = allPlugins.filter((p: any) => p.enabled).length;
    const stats = {
      ...state.stats,
      total: totalPlugins,
      enabled: enabledPlugins,
      disabled: totalPlugins - enabledPlugins,
    };

    return NextResponse.json({
      plugins: filteredPlugins,
      stats,
      errors: state.errors,
      count: filteredPlugins.length,
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
