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
import { installPluginFromNpm, uninstallPlugin } from '@/lib/plugins/installer';
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
    const validatedData = searchPluginsSchema.parse(body);// Perform multiple searches to find both scoped and unscoped plugins
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
      }));return NextResponse.json({
      results: plugins,
      count: plugins.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
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

    // Call the actual install function
    const result = await installPluginFromNpm(validatedData.packageName);

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

    // Call the actual uninstall function
    const result = await uninstallPlugin(validatedData.packageName);

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
    });

    // Reinitialize plugin system to reflect changes
    await initializePlugins();

    return NextResponse.json({
      success: true,
      message: 'Plugin uninstalled successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
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

export const GET = createAuthenticatedHandler(async (req: NextRequest, { user }) => {
  try {

    // Ensure plugin system is initialized before accessing registry
    // This handles cases where the API is called before startup initialization completes
    // or when hot-reloading resets module state in development
    if (!pluginRegistry.isInitialized()) {
      await initializePlugins();
    }

    const { searchParams } = new URL(req.url);
    const filter = searchParams.get('filter');

    // Get all plugins from registry
    const state = pluginRegistry.exportState();
    const plugins = [...state.plugins];

    // Apply filter
    let filteredPlugins = plugins;
    if (filter === 'installed') {
      filteredPlugins = plugins.filter((p: any) => p.enabled);
    }

    return NextResponse.json({
      plugins: filteredPlugins,
      stats: state.stats,
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
