/**
 * Theme Item API Routes (v1)
 *
 * GET /api/v1/themes/:themeId?action=tokens - Get tokens for a specific theme
 */

import { NextRequest } from 'next/server';
import { themeRegistry } from '@/lib/themes/theme-registry';
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup/plugin-initialization';
import { logger } from '@/lib/logger';
import { successResponse, notFound, serverError } from '@/lib/api/responses';

/**
 * Handle GET ?action=tokens
 * Returns the tokens and fonts for a specific theme
 */
async function handleGetTokens(
  themeId: string,
  request: NextRequest
): Promise<Response> {
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
      context: 'GET /api/v1/themes/[themeId]?action=tokens',
      themeId,
    });
    return notFound('Theme');
  }

  // Get theme data
  const theme = themeRegistry.get(themeId);
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
  }));

  // Include subsystem overrides (already resolved to full URLs by the registry)
  const subsystems = theme?.subsystems || undefined;

  return successResponse({ tokens, fonts, cssOverrides, subsystems });
}

/**
 * Default GET handler (no action specified)
 * Returns theme metadata
 */
async function handleDefaultGet(
  themeId: string,
  request: NextRequest
): Promise<Response> {
  // Ensure plugin/theme system is initialized
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
    return notFound('Theme');
  }

  // Get theme list and find this theme's metadata
  const themes = themeRegistry.getThemeList();
  const theme = themes.find(t => t.id === themeId);

  if (!theme) {
    return notFound('Theme');
  }

  return successResponse({ theme });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ themeId: string }> }
) {
  try {
    const { themeId } = await params;

    // Manually dispatch based on action query param (no auth context needed for public themes)
    const action = request.nextUrl.searchParams.get('action');
    if (action === 'tokens') {
      return handleGetTokens(themeId, request);
    }
    return handleDefaultGet(themeId, request);
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
    return serverError('Failed to retrieve theme');
  }
}
