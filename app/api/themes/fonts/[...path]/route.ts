/**
 * Theme Font File API Route
 *
 * Serves font files from theme plugins and theme bundles.
 * Path format: /api/themes/fonts/{pluginName}/{fontPath}
 *
 * For plugin themes: /api/themes/fonts/qtap-plugin-theme-rains/fonts/FiraCode-Regular.woff2
 * For bundle themes: /api/themes/fonts/bundle:{themeId}/fonts/MyFont.woff2
 *
 * Security: Only serves files from registered theme plugins/bundles with valid font definitions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { themeRegistry } from '@/lib/themes/theme-registry';
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup/plugin-initialization';
import { logger } from '@/lib/logger';
import * as fs from 'fs/promises';
import * as path from 'path';

// MIME types for font files
const FONT_MIME_TYPES: Record<string, string> = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.svg': 'image/svg+xml',
};

/**
 * GET /api/themes/fonts/[...path]
 * Serves font files from theme plugins
 *
 * @param request - Next.js request object
 * @param params - Route parameters containing the font path segments
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathSegments } = await params;

    if (!pathSegments || pathSegments.length < 2) {
      logger.warn('Invalid font path: insufficient segments', {
        context: 'GET /api/themes/fonts',
        pathSegments,
      });
      return NextResponse.json(
        { error: 'Invalid font path' },
        { status: 400 }
      );
    }

    // First segment is plugin name (or "bundle:" prefix for bundle themes), rest is the font path
    let pluginName: string;
    let fontPathSegments: string[];

    // Handle "bundle:" prefix - URL encoding may split it across segments
    if (pathSegments[0] === 'bundle' && pathSegments.length >= 3) {
      pluginName = `bundle:${pathSegments[1]}`;
      fontPathSegments = pathSegments.slice(2);
    } else if (pathSegments[0].startsWith('bundle:') || pathSegments[0].startsWith('bundle%3A')) {
      pluginName = decodeURIComponent(pathSegments[0]);
      fontPathSegments = pathSegments.slice(1);
    } else {
      [pluginName, ...fontPathSegments] = pathSegments;
    }
    const relativeFontPath = fontPathSegments.join('/');

    // Ensure plugin/theme system is initialized
    if (!isPluginSystemInitialized()) {
      logger.info('Plugin system not initialized, initializing now', {
        context: 'themes-fonts-GET',
      });
      await initializePlugins();
    }

    // Find the theme by plugin name
    const allThemes = themeRegistry.getAll();
    const theme = allThemes.find(t => t.pluginName === pluginName);

    if (!theme) {
      logger.warn('Theme not found for plugin', {
        context: 'GET /api/themes/fonts',
        pluginName,
      });
      return NextResponse.json(
        { error: 'Theme not found' },
        { status: 404 }
      );
    }

    // Check if this font is registered with the theme
    const fonts = themeRegistry.getFonts(theme.id);
    const fontEntry = fonts.find(f => f.src === relativeFontPath);

    if (!fontEntry) {
      logger.warn('Font not registered with theme', {
        context: 'GET /api/themes/fonts',
        themeId: theme.id,
        relativeFontPath,
        registeredFonts: fonts.map(f => f.src),
      });
      return NextResponse.json(
        { error: 'Font not found' },
        { status: 404 }
      );
    }

    // Security: Validate the path doesn't escape the plugin directory
    const normalizedPath = path.normalize(fontEntry.filePath);
    if (normalizedPath.includes('..')) {
      logger.warn('Path traversal attempt detected', {
        context: 'GET /api/themes/fonts',
        filePath: fontEntry.filePath,
      });
      return NextResponse.json(
        { error: 'Invalid path' },
        { status: 400 }
      );
    }

    // Read the font file
    try {
      const fontBuffer = await fs.readFile(fontEntry.filePath);

      // Determine MIME type from extension
      const ext = path.extname(fontEntry.filePath).toLowerCase();
      const mimeType = FONT_MIME_TYPES[ext] || 'application/octet-stream';// Return the font with appropriate headers
      return new NextResponse(new Uint8Array(fontBuffer), {
        status: 200,
        headers: {
          'Content-Type': mimeType,
          'Content-Length': fontBuffer.length.toString(),
          // Cache for 1 year (fonts don't change often)
          'Cache-Control': 'public, max-age=31536000, immutable',
          // CORS headers for font loading
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (readError) {
      logger.error(
        'Failed to read font file',
        {
          context: 'GET /api/themes/fonts',
          filePath: fontEntry.filePath,
        },
        readError instanceof Error ? readError : undefined
      );
      return NextResponse.json(
        { error: 'Font file not found' },
        { status: 404 }
      );
    }
  } catch (error) {
    logger.error(
      'Failed to serve font',
      { context: 'GET /api/themes/fonts' },
      error instanceof Error ? error : undefined
    );
    return NextResponse.json(
      { error: 'Failed to serve font' },
      { status: 500 }
    );
  }
}
