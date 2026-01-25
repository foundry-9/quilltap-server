/**
 * Theme Asset File API Route
 *
 * Serves static asset files (images, etc.) from theme plugins.
 * Path format: /api/themes/assets/{pluginName}/{assetPath}
 *
 * Example: /api/themes/assets/qtap-plugin-theme-ocean/ocean-bg-1.png
 *
 * Security: Only serves files from registered theme plugins within their directory.
 */

import { NextRequest, NextResponse } from 'next/server';
import { themeRegistry } from '@/lib/themes/theme-registry';
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup/plugin-initialization';
import { logger } from '@/lib/logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import { pluginRegistry } from '@/lib/plugins';

// MIME types for common asset files
const ASSET_MIME_TYPES: Record<string, string> = {
  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  // Other assets
  '.json': 'application/json',
  '.css': 'text/css',
};

// Allowed file extensions for security
const ALLOWED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.avif',
]);

/**
 * GET /api/themes/assets/[...path]
 * Serves asset files from theme plugins
 *
 * @param request - Next.js request object
 * @param params - Route parameters containing the asset path segments
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathSegments } = await params;

    if (!pathSegments || pathSegments.length < 2) {
      logger.warn('Invalid asset path: insufficient segments', {
        context: 'GET /api/themes/assets',
        pathSegments,
      });
      return NextResponse.json(
        { error: 'Invalid asset path' },
        { status: 400 }
      );
    }

    // First segment is plugin name, rest is the asset path within the plugin
    const [pluginName, ...assetPathSegments] = pathSegments;
    const relativeAssetPath = assetPathSegments.join('/');// Ensure plugin/theme system is initialized
    if (!isPluginSystemInitialized()) {
      logger.info('Plugin system not initialized, initializing now', {
        context: 'themes-assets-GET',
      });
      await initializePlugins();
    }

    // Find the theme by plugin name
    const allThemes = themeRegistry.getAll();
    const theme = allThemes.find(t => t.pluginName === pluginName);

    if (!theme) {
      logger.warn('Theme not found for plugin', {
        context: 'GET /api/themes/assets',
        pluginName,
      });
      return NextResponse.json(
        { error: 'Theme not found' },
        { status: 404 }
      );
    }

    // Get the plugin to find its directory
    const plugin = pluginRegistry.get(pluginName);
    if (!plugin) {
      logger.warn('Plugin not found', {
        context: 'GET /api/themes/assets',
        pluginName,
      });
      return NextResponse.json(
        { error: 'Plugin not found' },
        { status: 404 }
      );
    }

    // Validate file extension for security
    const ext = path.extname(relativeAssetPath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      logger.warn('Disallowed file extension', {
        context: 'GET /api/themes/assets',
        extension: ext,
        relativeAssetPath,
      });
      return NextResponse.json(
        { error: 'File type not allowed' },
        { status: 403 }
      );
    }

    // Construct and validate the absolute file path
    const pluginDir = path.dirname(plugin.manifestPath);
    const absoluteAssetPath = path.resolve(pluginDir, relativeAssetPath);

    // Security: Ensure the resolved path is within the plugin directory
    if (!absoluteAssetPath.startsWith(pluginDir)) {
      logger.warn('Path traversal attempt detected', {
        context: 'GET /api/themes/assets',
        pluginDir,
        resolvedPath: absoluteAssetPath,
      });
      return NextResponse.json(
        { error: 'Invalid path' },
        { status: 400 }
      );
    }

    // Read the asset file
    try {
      const assetBuffer = await fs.readFile(absoluteAssetPath);

      // Determine MIME type from extension
      const mimeType = ASSET_MIME_TYPES[ext] || 'application/octet-stream';// Return the asset with appropriate headers
      return new NextResponse(new Uint8Array(assetBuffer), {
        status: 200,
        headers: {
          'Content-Type': mimeType,
          'Content-Length': assetBuffer.length.toString(),
          // Cache for 1 year (theme assets don't change often)
          'Cache-Control': 'public, max-age=31536000, immutable',
          // CORS headers
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (readError) {
      logger.error(
        'Failed to read asset file',
        {
          context: 'GET /api/themes/assets',
          filePath: absoluteAssetPath,
        },
        readError instanceof Error ? readError : undefined
      );
      return NextResponse.json(
        { error: 'Asset file not found' },
        { status: 404 }
      );
    }
  } catch (error) {
    logger.error(
      'Failed to serve asset',
      { context: 'GET /api/themes/assets' },
      error instanceof Error ? error : undefined
    );
    return NextResponse.json(
      { error: 'Failed to serve asset' },
      { status: 500 }
    );
  }
}
