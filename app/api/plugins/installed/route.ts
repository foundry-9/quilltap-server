import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { getInstalledPlugins, isPluginInstalled } from '@/lib/plugins/installer';

/**
 * GET /api/plugins/installed
 * Get all installed plugins with their metadata
 *
 * Query params:
 * - scope: 'all' | 'bundled' | 'site' | 'user' (default: 'all')
 * - check: package name to check if installed (optional)
 */
export const GET = createAuthenticatedHandler(async (req: NextRequest, { user }) => {
  try {
    const { searchParams } = new URL(req.url);
    const scope = (searchParams.get('scope') || 'all') as 'all' | 'bundled' | 'site' | 'user';
    const checkPackage = searchParams.get('check');

    // If checking a specific package
    if (checkPackage) {
      logger.debug('Checking plugin installation status', {
        context: 'plugins-installed-GET',
        package: checkPackage,
      });

      const status = await isPluginInstalled(checkPackage, user.id);
      return NextResponse.json({
        package: checkPackage,
        installed: status.installed,
        scope: status.scope,
      });
    }

    // Get all installed plugins
    logger.debug('Fetching installed plugins', {
      context: 'plugins-installed-GET',
      scope,
      userId: user.id.substring(0, 8),
    });

    const plugins = await getInstalledPlugins(scope, user.id);

    // Transform to a cleaner format for the frontend
    const formattedPlugins = plugins.map(plugin => ({
      name: plugin.name,
      title: plugin.manifest.title,
      version: plugin.version,
      description: plugin.manifest.description,
      author: plugin.manifest.author,
      source: plugin.source,
      capabilities: plugin.manifest.capabilities,
      category: plugin.manifest.category,
      installedAt: plugin.installedAt,
      status: plugin.manifest.status,
    }));

    logger.info('Retrieved installed plugins', {
      context: 'plugins-installed-GET',
      scope,
      count: formattedPlugins.length,
    });

    return NextResponse.json({
      plugins: formattedPlugins,
      counts: {
        total: formattedPlugins.length,
        bundled: formattedPlugins.filter(p => p.source === 'bundled').length,
        site: formattedPlugins.filter(p => p.source === 'site').length,
        user: formattedPlugins.filter(p => p.source === 'user').length,
      },
    });

  } catch (error) {
    logger.error(
      'Failed to get installed plugins',
      { context: 'plugins-installed-GET' },
      error instanceof Error ? error : new Error(String(error))
    );
    return NextResponse.json(
      { error: 'Failed to retrieve installed plugins' },
      { status: 500 }
    );
  }
});
