/**
 * Theme Tokens API Routes
 *
 * GET /api/themes/:themeId/tokens - Get tokens for a specific theme
 */

import { NextRequest, NextResponse } from 'next/server';
import { themeRegistry } from '@/lib/themes/theme-registry';
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup/plugin-initialization';
import { logger } from '@/lib/logger';

/**
 * GET /api/themes/:themeId/tokens
 * Returns the tokens for a specific theme
 *
 * Params:
 * - themeId: Theme identifier (e.g., "default", "ocean")
 *
 * Response format:
 * {
 *   colors: {
 *     light: ColorPalette;
 *     dark: ColorPalette;
 *   };
 *   typography?: Typography;
 *   spacing?: Spacing;
 *   effects?: Effects;
 * }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ themeId: string }> }
) {
  try {
    const { themeId } = await params;

    logger.debug('Fetching theme tokens', {
      context: 'GET /api/themes/[themeId]/tokens',
      themeId,
    });

    // Ensure plugin/theme system is initialized
    if (!isPluginSystemInitialized()) {
      logger.info('Plugin system not initialized, initializing now', {
        context: 'theme-tokens-GET',
      });
      await initializePlugins();
    }

    // Check if theme exists
    if (!themeRegistry.has(themeId)) {
      logger.warn('Theme not found', {
        context: 'GET /api/themes/[themeId]/tokens',
        themeId,
      });
      return NextResponse.json(
        { error: 'Theme not found' },
        { status: 404 }
      );
    }

    // Get theme tokens
    const tokens = themeRegistry.getTokens(themeId);

    logger.debug('Theme tokens retrieved successfully', {
      context: 'GET /api/themes/[themeId]/tokens',
      themeId,
    });

    return NextResponse.json(tokens);
  } catch (error) {
    const themeIdParam = await params.catch(() => ({ themeId: 'unknown' }));
    logger.error(
      'Failed to get theme tokens',
      {
        context: 'GET /api/themes/[themeId]/tokens',
        themeId: 'themeId' in themeIdParam ? themeIdParam.themeId : 'unknown',
      },
      error instanceof Error ? error : undefined
    );
    return NextResponse.json(
      { error: 'Failed to retrieve theme tokens' },
      { status: 500 }
    );
  }
}
