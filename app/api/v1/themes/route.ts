/**
 * Theme API Routes (v1)
 *
 * GET /api/v1/themes - Get list of available themes
 */

import { NextResponse } from 'next/server';
import { themeRegistry } from '@/lib/themes/theme-registry';
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup/plugin-initialization';
import { logger } from '@/lib/logger';

/**
 * GET /api/v1/themes
 * Returns list of available theme plugins
 *
 * Response format:
 * {
 *   themes: Array<{
 *     id: string;
 *     name: string;
 *     description?: string;
 *     supportsDarkMode: boolean;
 *     previewImage?: string;
 *     tags: string[];
 *     isDefault: boolean;
 *   }>;
 *   stats: {
 *     total: number;
 *     withDarkMode: number;
 *     withCssOverrides: number;
 *   };
 * }
 */
export async function GET() {
  try {

    // Ensure plugin/theme system is initialized
    if (!isPluginSystemInitialized()) {
      logger.info('Plugin system not initialized, initializing now', {
        context: 'themes-GET',
      });
      await initializePlugins();
    }

    // Get theme list (without full tokens for efficiency)
    const themes = themeRegistry.getThemeList();
    const stats = themeRegistry.getStats();return NextResponse.json({
      themes,
      stats: {
        total: stats.total,
        withDarkMode: stats.withDarkMode,
        withCssOverrides: stats.withCssOverrides,
      },
    });
  } catch (error) {
    logger.error(
      'Failed to get themes',
      { context: 'GET /api/v1/themes' },
      error instanceof Error ? error : undefined
    );
    return NextResponse.json(
      { error: 'Failed to retrieve themes' },
      { status: 500 }
    );
  }
}
