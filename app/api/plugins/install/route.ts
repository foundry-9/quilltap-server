import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { installPluginFromNpm, type PluginScope } from '@/lib/plugins/installer';

interface InstallRequestBody {
  packageName: string;
  scope?: PluginScope;
}

/**
 * Check if a package name is a valid Quilltap plugin
 * Matches both unscoped (qtap-plugin-*) and scoped (@org/qtap-plugin-*) packages
 */
function isQuilltapPlugin(name: string): boolean {
  // Unscoped: qtap-plugin-openai
  if (name.startsWith('qtap-plugin-')) {
    return true;
  }
  // Scoped: @quilltap/qtap-plugin-gab-ai, @myorg/qtap-plugin-custom
  if (name.startsWith('@') && name.includes('/qtap-plugin-')) {
    return true;
  }
  return false;
}

/**
 * POST /api/plugins/install
 * Install a plugin from npm registry
 */
export const POST = createAuthenticatedHandler(async (req: NextRequest, { user }) => {
  try {
    const body: InstallRequestBody = await req.json();
    const { packageName, scope = 'user' } = body;

    if (!packageName || typeof packageName !== 'string') {
      return NextResponse.json(
        { error: 'Package name is required' },
        { status: 400 }
      );
    }

    if (!isQuilltapPlugin(packageName)) {
      return NextResponse.json(
        { error: 'Package name must be a Quilltap plugin (qtap-plugin-* or @org/qtap-plugin-*)' },
        { status: 400 }
      );
    }

    if (scope !== 'site' && scope !== 'user') {
      return NextResponse.json(
        { error: 'Invalid scope. Must be "site" or "user"' },
        { status: 400 }
      );
    }

    logger.info('Plugin installation requested', {
      context: 'plugins-install-POST',
      packageName,
      scope,
      userId: user.id.substring(0, 8),
    });

    // TODO: Add admin check for site-wide plugins
    // For now, allow any authenticated user to install site plugins
    // In the future, this should check session.user.isAdmin
    // if (scope === 'site' && !session.user.isAdmin) {
    //   return NextResponse.json(
    //     { error: 'Admin privileges required for site-wide plugin installation' },
    //     { status: 403 }
    //   );
    // }

    const result = await installPluginFromNpm(
      packageName,
      scope,
      scope === 'user' ? user.id : undefined
    );

    if (!result.success) {
      logger.warn('Plugin installation failed', {
        context: 'plugins-install-POST',
        packageName,
        error: result.error,
      });
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    logger.info('Plugin installed successfully', {
      context: 'plugins-install-POST',
      packageName,
      version: result.version,
      scope,
    });

    return NextResponse.json({
      success: true,
      plugin: {
        name: result.manifest?.name,
        title: result.manifest?.title,
        version: result.version,
        description: result.manifest?.description,
        capabilities: result.manifest?.capabilities,
      },
      message: 'Plugin installed successfully. Restart Quilltap to activate the plugin.',
    });

  } catch (error) {
    logger.error(
      'Plugin installation request failed',
      { context: 'plugins-install-POST' },
      error instanceof Error ? error : new Error(String(error))
    );
    return NextResponse.json(
      { error: 'Failed to install plugin' },
      { status: 500 }
    );
  }
});
