/**
 * Theme Asset File API Route
 *
 * Serves the files a theme bundle declares or its compiled CSS points at.
 * Path format: /api/themes/assets/bundle:{themeId}/{assetPath}
 *
 * Only paths in the theme's served set (`themeRegistry.getServedAssets`) are
 * served: the preview image, icon overrides, subsystem images, font licence
 * files and each `url()` in the compiled CSS. Anything else in the bundle
 * directory is a 404, and the file must still resolve inside the bundle.
 */

import { NextRequest, NextResponse } from 'next/server';
import { themeRegistry } from '@/lib/themes/theme-registry';
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup/plugin-initialization';
import { logger } from '@/lib/logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import { resolveInside, PathOutsideBaseError } from '@/lib/paths/resolve-inside';
import { serveStoredBytes } from '@/lib/api/serve-stored-bytes';
import { normaliseBundlePath } from '@/lib/themes/engine/css-text';

// MIME types for the files a theme may have served
const ASSET_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  // Font licence files
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '': 'text/plain; charset=utf-8',
};

function notFound(): NextResponse {
  return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
}

/**
 * GET /api/themes/assets/[...path]
 * Serves a theme bundle's declared and referenced files
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

    // First segment is "bundle:<themeId>" (URL encoding may split it), rest is the asset path
    let pluginName: string;
    let assetPathSegments: string[];
    if (pathSegments[0] === 'bundle' && pathSegments.length >= 3) {
      pluginName = `bundle:${pathSegments[1]}`;
      assetPathSegments = pathSegments.slice(2);
    } else if (pathSegments[0].startsWith('bundle:') || pathSegments[0].startsWith('bundle%3A')) {
      pluginName = decodeURIComponent(pathSegments[0]);
      assetPathSegments = pathSegments.slice(1);
    } else {
      logger.debug('Theme asset request outside a bundle', { context: 'GET /api/themes/assets', first: pathSegments[0] });
      return notFound();
    }

    // Ensure plugin/theme system is initialized
    if (!isPluginSystemInitialized()) {
      logger.info('Plugin system not initialized, initializing now', {
        context: 'themes-assets-GET',
      });
      await initializePlugins();
    }

    const theme = themeRegistry.getAll().find(t => t.pluginName === pluginName);
    if (!theme || theme.source !== 'bundle' || !theme.bundlePath) {
      logger.warn('Theme not found for asset', { context: 'GET /api/themes/assets', pluginName });
      return notFound();
    }

    const relativeAssetPath = normaliseBundlePath(assetPathSegments.join('/'));

    // Only what the theme declares or its CSS references is served.
    if (!themeRegistry.getServedAssets(theme.id).has(relativeAssetPath)) {
      logger.warn('Theme asset not in the served set', {
        context: 'GET /api/themes/assets',
        themeId: theme.id,
        relativeAssetPath,
      });
      return notFound();
    }

    const ext = path.extname(relativeAssetPath).toLowerCase();
    const mimeType = ASSET_MIME_TYPES[ext];
    if (!mimeType) {
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

    // The asset must resolve inside the bundle (symlinks resolved).
    let absoluteAssetPath: string;
    try {
      absoluteAssetPath = await resolveInside(theme.bundlePath, relativeAssetPath, { realpath: true });
    } catch (err) {
      if (!(err instanceof PathOutsideBaseError)) throw err;
      logger.warn('Asset path outside its theme directory', {
        context: 'GET /api/themes/assets',
        themeId: theme.id,
        relativeAssetPath,
        reason: err.reason,
      });
      return NextResponse.json(
        { error: 'Invalid path' },
        { status: 400 }
      );
    }

    // Read the asset file
    try {
      const assetBuffer = await fs.readFile(absoluteAssetPath);

      logger.debug('Serving theme asset', { context: 'GET /api/themes/assets', pluginName, relativeAssetPath });
      // SVG keeps image/svg+xml (CSS url() needs it) but is never inline: a
      // direct navigation downloads it, while CSS and <img> ignore disposition.
      return serveStoredBytes(new Uint8Array(assetBuffer), {
        mimeType,
        filename: path.basename(absoluteAssetPath),
        // Cache for 1 year (theme assets don't change often)
        cacheControl: 'public, max-age=31536000, immutable',
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
