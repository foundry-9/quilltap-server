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
 * Returns the tokens and fonts for a specific theme
 *
 * Params:
 * - themeId: Theme identifier (e.g., "default", "ocean")
 *
 * Response format:
 * {
 *   tokens: {
 *     colors: {
 *       light: ColorPalette;
 *       dark: ColorPalette;
 *     };
 *     typography?: Typography;
 *     spacing?: Spacing;
 *     effects?: Effects;
 *   };
 *   fonts?: Array<{
 *     family: string;
 *     src: string;
 *     weight: string;
 *     style: string;
 *     display: string;
 *   }>;
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

    // Get theme tokens and fonts
    const tokens = themeRegistry.getTokens(themeId);
    const loadedFonts = themeRegistry.getFonts(themeId);

    // Convert fonts to client-friendly format with API URLs
    const fonts = loadedFonts.map(font => ({
      family: font.family,
      // Build URL to serve font via our API route
      src: `/api/themes/fonts/${font.pluginName}/${font.src}`,
      weight: font.weight,
      style: font.style,
      display: font.display,
    }));

    logger.debug('Theme tokens retrieved successfully', {
      context: 'GET /api/themes/[themeId]/tokens',
      themeId,
      fontCount: fonts.length,
    });

    return NextResponse.json({ tokens, fonts });
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
