/**
 * Theme API Routes (v1)
 *
 * GET  /api/v1/themes - Get list of available themes
 * GET  /api/v1/themes?action=registry - Browse registry themes
 * GET  /api/v1/themes?action=registry-sources - List configured registries
 * GET  /api/v1/themes?action=updates - Check for available theme updates
 * POST /api/v1/themes?action=install - Install a .qtap-theme bundle (multipart upload)
 * POST /api/v1/themes?action=install-from-url - Install a .qtap-theme bundle from URL
 * POST /api/v1/themes?action=add-source - Add a registry source
 * POST /api/v1/themes?action=remove-source - Remove a registry source
 * POST /api/v1/themes?action=refresh - Refresh all registry indexes
 * POST /api/v1/themes?action=install-registry - Install a theme from a registry
 */

import { NextRequest } from 'next/server';
import { themeRegistry } from '@/lib/themes/theme-registry';
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup/plugin-initialization';
import { logger } from '@/lib/logger';
import { successResponse, badRequest, serverError, created } from '@/lib/api/responses';
import { getActionParam, isValidAction } from '@/lib/api/middleware/actions';
import { installThemeBundle, installThemeBundleFromUrl, loadInstalledBundles } from '@/lib/themes/bundle-loader';
import {
  getSources,
  addSource,
  removeSource,
  refreshAllRegistries,
  searchThemes,
  installFromRegistry,
  checkForUpdates,
} from '@/lib/themes/registry-client';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const THEME_GET_ACTIONS = ['registry', 'registry-sources', 'updates'] as const;
type ThemeGetAction = typeof THEME_GET_ACTIONS[number];
const THEME_POST_ACTIONS = ['install', 'install-from-url', 'add-source', 'remove-source', 'refresh', 'install-registry'] as const;
type ThemePostAction = typeof THEME_POST_ACTIONS[number];

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
 * Returns list of available themes or handles registry actions
 */
export async function GET(request: NextRequest) {
  try {
    await ensureInitialized();

    const action = getActionParam(request);

    if (!action) {
      return handleGetThemes();
    }

    if (!isValidAction(action, THEME_GET_ACTIONS)) {
      return badRequest(`Unknown action: ${action}`, {
        availableActions: [...THEME_GET_ACTIONS],
      });
    }

    const actionHandlers: Record<ThemeGetAction, () => Promise<Response>> = {
      registry: () => handleGetRegistry(request),
      'registry-sources': () => handleGetRegistrySources(),
      updates: () => handleGetUpdates(),
    };

    return actionHandlers[action]();
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
 * Default GET: list installed themes
 */
async function handleGetThemes() {
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
}

/**
 * GET ?action=registry — browse themes from all enabled registries
 */
async function handleGetRegistry(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q') || '';

  // searchThemes uses cached indexes (with 1-hour TTL), returning all if query is empty
  const themes = await searchThemes(query);

  return successResponse({ themes });
}

/**
 * GET ?action=registry-sources — list configured registries
 */
async function handleGetRegistrySources() {
  const sources = await getSources();
  return successResponse({ sources });
}

/**
 * GET ?action=updates — check for available theme updates
 */
async function handleGetUpdates() {
  const updates = await checkForUpdates();
  return successResponse({ updates });
}

/**
 * POST /api/v1/themes
 * Dispatches based on ?action= query parameter
 */
export async function POST(request: NextRequest) {
  try {
    await ensureInitialized();

    const action = getActionParam(request);

    if (!action) {
      return badRequest('Action parameter required', {
        availableActions: [...THEME_POST_ACTIONS],
      });
    }

    if (!isValidAction(action, THEME_POST_ACTIONS)) {
      return badRequest(`Unknown action: ${action}`, {
        availableActions: [...THEME_POST_ACTIONS],
      });
    }

    const actionHandlers: Record<ThemePostAction, () => Promise<Response>> = {
      install: () => handleInstall(request),
      'install-from-url': () => handleInstallFromUrl(request),
      'add-source': () => handleAddSource(request),
      'remove-source': () => handleRemoveSource(request),
      refresh: () => handleRefresh(),
      'install-registry': () => handleInstallFromRegistryAction(request),
    };

    return actionHandlers[action]();
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

// ============================================================================
// REGISTRY ACTION HANDLERS
// ============================================================================

/**
 * Handle POST ?action=add-source
 * Add a new registry source
 */
async function handleAddSource(request: NextRequest) {
  let body: { name?: string; url?: string; publicKey?: string };
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  if (!body.url || typeof body.url !== 'string') {
    return badRequest('Missing or invalid "url" field');
  }

  try {
    new URL(body.url);
  } catch {
    return badRequest('Invalid URL format');
  }

  try {
    const source = await addSource({
      name: body.name || new URL(body.url).hostname,
      url: body.url,
      publicKey: body.publicKey,
    });

    return created({
      message: 'Registry source added',
      source,
    });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : 'Failed to add source');
  }
}

/**
 * Handle POST ?action=remove-source
 * Remove a registry source by name
 */
async function handleRemoveSource(request: NextRequest) {
  let body: { name?: string };
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  if (!body.name || typeof body.name !== 'string') {
    return badRequest('Missing or invalid "name" field');
  }

  const removed = await removeSource(body.name);
  if (!removed) {
    return badRequest(`Registry source "${body.name}" not found`);
  }

  return successResponse({ message: `Registry source "${body.name}" removed` });
}

/**
 * Handle POST ?action=refresh
 * Refresh all registry indexes
 */
async function handleRefresh() {
  const themes = await refreshAllRegistries();
  return successResponse({
    message: `Refreshed registries, found ${themes.length} themes`,
    themeCount: themes.length,
  });
}

/**
 * Handle POST ?action=install-registry
 * Install a theme from a registry
 */
async function handleInstallFromRegistryAction(request: NextRequest) {
  let body: { themeId?: string; registryUrl?: string };
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  if (!body.themeId || typeof body.themeId !== 'string') {
    return badRequest('Missing or invalid "themeId" field');
  }
  if (!body.registryUrl || typeof body.registryUrl !== 'string') {
    return badRequest('Missing or invalid "registryUrl" field');
  }

  const result = await installFromRegistry(body.themeId, body.registryUrl);

  if (!result.success) {
    return badRequest(`Registry installation failed: ${result.error}`);
  }

  // Hot-load the newly installed theme into the registry
  const bundles = await loadInstalledBundles();
  const newBundle = bundles.find(b => b.manifest.id === result.themeId);
  if (newBundle) {
    themeRegistry.registerBundleTheme(newBundle);
  }

  return created({
    message: 'Theme installed from registry',
    themeId: result.themeId,
    version: result.version,
  });
}
