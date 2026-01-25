/**
 * Theme Item API Routes (v1)
 *
 * GET /api/v1/themes/:themeId?action=tokens - Get tokens for a specific theme
 */

import { NextRequest, NextResponse } from 'next/server';
import { themeRegistry } from '@/lib/themes/theme-registry';
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup/plugin-initialization';
import { withActionDispatch } from '@/lib/api/middleware/actions';
import { logger } from '@/lib/logger';

/**
 * Handle GET ?action=tokens
 * Returns the tokens and fonts for a specific theme
 */
async function handleGetTokens(
  request: NextRequest,
  themeId: string
): Promise<NextResponse> {// Ensure plugin/theme system is initialized
  if (!isPluginSystemInitialized()) {
    logger.info('Plugin system not initialized, initializing now', {
      context: 'theme-tokens-GET',
    });
    await initializePlugins();
  }

  // Check if theme exists
  if (!themeRegistry.has(themeId)) {
    logger.warn('Theme not found', {
      context: 'GET /api/v1/themes/[themeId]?action=tokens',
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
  const cssOverrides = themeRegistry.getCSSOverrides(themeId);

  // Convert fonts to client-friendly format with API URLs
  const fonts = loadedFonts.map(font => ({
    family: font.family,
    // Build URL to serve font via our API route
    src: `/api/themes/fonts/${font.pluginName}/${font.src}`,
    weight: font.weight,
    style: font.style,
    display: font.display,
  }));return NextResponse.json({ tokens, fonts, cssOverrides });
}

/**
 * Default GET handler (no action specified)
 * Returns theme metadata
 */
async function handleDefaultGet(
  request: NextRequest,
  themeId: string
): Promise<NextResponse> {// Ensure plugin/theme system is initialized
  if (!isPluginSystemInitialized()) {
    logger.info('Plugin system not initialized, initializing now', {
      context: 'theme-GET',
    });
    await initializePlugins();
  }

  // Check if theme exists
  if (!themeRegistry.has(themeId)) {
    logger.warn('Theme not found', {
      context: 'GET /api/v1/themes/[themeId]',
      themeId,
    });
    return NextResponse.json(
      { error: 'Theme not found' },
      { status: 404 }
    );
  }

  // Get theme list and find this theme's metadata
  const themes = themeRegistry.getThemeList();
  const theme = themes.find(t => t.id === themeId);

  if (!theme) {
    return NextResponse.json(
      { error: 'Theme not found' },
      { status: 404 }
    );
  }return NextResponse.json({ theme });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ themeId: string }> }
) {
  try {
    const { themeId } = await params;

    // Use action dispatch for different GET operations
    const actionDispatcher = withActionDispatch<{ themeId: string }>(
      {
        tokens: async (req, _ctx, { themeId }) => handleGetTokens(req, themeId),
      },
      async (req, _ctx, { themeId }) => handleDefaultGet(req, themeId)
    );

    // Call the dispatcher with mock context (not using auth middleware here since themes are public)
    return actionDispatcher(request, {} as any, { themeId });
  } catch (error) {
    const themeIdParam = await params.catch(() => ({ themeId: 'unknown' }));
    logger.error(
      'Failed to get theme',
      {
        context: 'GET /api/v1/themes/[themeId]',
        themeId: 'themeId' in themeIdParam ? themeIdParam.themeId : 'unknown',
      },
      error instanceof Error ? error : undefined
    );
    return NextResponse.json(
      { error: 'Failed to retrieve theme' },
      { status: 500 }
    );
  }
}
