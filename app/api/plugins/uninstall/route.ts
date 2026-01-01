import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { uninstallPlugin, type PluginScope } from '@/lib/plugins/installer';

interface UninstallRequestBody {
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
 * POST /api/plugins/uninstall
 * Uninstall an installed plugin
 */
export const POST = createAuthenticatedHandler(async (req: NextRequest, { user }) => {
  try {
    const body: UninstallRequestBody = await req.json();
    const { packageName, scope = 'user' } = body;

    if (!packageName || typeof packageName !== 'string') {
      return NextResponse.json(
        { error: 'Package name is required' },
        { status: 400 }
      );
    }

    if (!isQuilltapPlugin(packageName)) {
      return NextResponse.json(
        { error: 'Invalid package name - must be a Quilltap plugin' },
        { status: 400 }
      );
    }

    if (scope !== 'site' && scope !== 'user') {
      return NextResponse.json(
        { error: 'Invalid scope. Must be "site" or "user"' },
        { status: 400 }
      );
    }

    // Note: Bundled plugins cannot be uninstalled via this API since
    // they are in plugins/dist, not in site or user directories

    logger.info('Plugin uninstall requested', {
      context: 'plugins-uninstall-POST',
      packageName,
      scope,
      userId: user.id.substring(0, 8),
    });

    // TODO: Add admin check for site-wide plugins
    // if (scope === 'site' && !session.user.isAdmin) {
    //   return NextResponse.json(
    //     { error: 'Admin privileges required for site-wide plugin removal' },
    //     { status: 403 }
    //   );
    // }

    const result = await uninstallPlugin(
      packageName,
      scope,
      scope === 'user' ? user.id : undefined
    );

    if (!result.success) {
      logger.warn('Plugin uninstall failed', {
        context: 'plugins-uninstall-POST',
        packageName,
        error: result.error,
      });
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    logger.info('Plugin uninstalled successfully', {
      context: 'plugins-uninstall-POST',
      packageName,
      scope,
    });

    return NextResponse.json({
      success: true,
      message: 'Plugin uninstalled successfully. Restart Quilltap to complete removal.',
    });

  } catch (error) {
    logger.error(
      'Plugin uninstall request failed',
      { context: 'plugins-uninstall-POST' },
      error instanceof Error ? error : new Error(String(error))
    );
    return NextResponse.json(
      { error: 'Failed to uninstall plugin' },
      { status: 500 }
    );
  }
});
