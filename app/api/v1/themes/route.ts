/**
 * Theme API Routes (v1)
 *
 * GET  /api/v1/themes - Get list of available themes
 * POST /api/v1/themes?action=install - Install a .qtap-theme bundle (multipart upload)
 * POST /api/v1/themes?action=install-from-url - Install a .qtap-theme bundle from URL
 */

import { NextRequest } from 'next/server';
import { themeRegistry } from '@/lib/themes/theme-registry';
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup/plugin-initialization';
import { logger } from '@/lib/logger';
import { successResponse, badRequest, serverError, created } from '@/lib/api/responses';
import { installThemeBundle, installThemeBundleFromUrl, loadInstalledBundles } from '@/lib/themes/bundle-loader';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

async function ensureInitialized() {
  if (!isPluginSystemInitialized()) {
    logger.info('Plugin system not initialized, initializing now', {
      context: 'themes-api',
    });
    await initializePlugins();
  }
}

/**
 * GET /api/v1/themes
 * Returns list of available themes (plugins + bundles)
 */
export async function GET() {
  try {
    await ensureInitialized();

    const themes = themeRegistry.getThemeList();
    const stats = themeRegistry.getStats();
    return successResponse({
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
    return serverError('Failed to retrieve themes');
  }
}

/**
 * POST /api/v1/themes
 * Dispatches based on ?action= query parameter
 */
export async function POST(request: NextRequest) {
  try {
    await ensureInitialized();

    const action = request.nextUrl.searchParams.get('action');

    switch (action) {
      case 'install':
        return handleInstall(request);
      case 'install-from-url':
        return handleInstallFromUrl(request);
      default:
        return badRequest(
          action ? `Unknown action: ${action}` : 'Action parameter required',
          { availableActions: ['install', 'install-from-url'] }
        );
    }
  } catch (error) {
    logger.error(
      'Failed to process theme action',
      { context: 'POST /api/v1/themes' },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to process theme action');
  }
}

/**
 * Handle POST ?action=install
 * Accepts multipart form upload of a .qtap-theme file
 */
async function handleInstall(request: NextRequest) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return badRequest('Expected multipart/form-data with a .qtap-theme file');
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    logger.warn('Failed to parse form data', {
      context: 'POST /api/v1/themes?action=install',
      error: err instanceof Error ? err.message : String(err),
    });
    return badRequest('Failed to parse form data');
  }

  const file = formData.get('theme') as File | null;
  if (!file) {
    return badRequest('No "theme" file field in form data');
  }

  // Write to temp file
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qtap-theme-upload-'));
  const tempFile = path.join(tempDir, file.name || 'theme.qtap-theme');

  try {
    const arrayBuffer = await file.arrayBuffer();
    await fs.writeFile(tempFile, Buffer.from(arrayBuffer));

    logger.debug('Theme bundle uploaded', {
      context: 'POST /api/v1/themes?action=install',
      fileName: file.name,
      size: arrayBuffer.byteLength,
    });

    const result = await installThemeBundle(tempFile);

    if (!result.success) {
      return badRequest(`Theme installation failed: ${result.error}`);
    }

    // Hot-load the newly installed theme into the registry
    const bundles = await loadInstalledBundles();
    const newBundle = bundles.find(b => b.manifest.id === result.themeId);
    if (newBundle) {
      themeRegistry.registerBundleTheme(newBundle);
    }

    return created({
      message: 'Theme installed successfully',
      themeId: result.themeId,
      version: result.version,
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * Handle POST ?action=install-from-url
 * Accepts { url: string } in JSON body
 */
async function handleInstallFromUrl(request: NextRequest) {
  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  if (!body.url || typeof body.url !== 'string') {
    return badRequest('Missing or invalid "url" field');
  }

  // Basic URL validation
  try {
    new URL(body.url);
  } catch {
    return badRequest('Invalid URL format');
  }

  logger.debug('Installing theme from URL', {
    context: 'POST /api/v1/themes?action=install-from-url',
    url: body.url,
  });

  const result = await installThemeBundleFromUrl(body.url);

  if (!result.success) {
    return badRequest(`Theme installation failed: ${result.error}`);
  }

  // Hot-load the newly installed theme into the registry
  const bundles = await loadInstalledBundles();
  const newBundle = bundles.find(b => b.manifest.id === result.themeId);
  if (newBundle) {
    themeRegistry.registerBundleTheme(newBundle);
  }

  return created({
    message: 'Theme installed successfully',
    themeId: result.themeId,
    version: result.version,
  });
}
