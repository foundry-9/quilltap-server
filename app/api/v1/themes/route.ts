/**
 * Theme API Routes (v1)
 *
 * GET  /api/v1/themes - Get list of available themes (and those refused)
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

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { successResponse, badRequest, serverError, created } from '@/lib/api/responses';
import { dispatchAction } from '@/lib/api/middleware/actions';
// Dynamic imports prevent Turbopack from tracing the extensive filesystem
// operations in the plugin/theme systems into the NFT list
const getPluginInit = () => import('@/lib/startup/plugin-initialization');
const getThemeRegistry = () => import('@/lib/themes/theme-registry');
const getBundleLoader = () => import('@/lib/themes/bundle-loader');
const getRegistryClient = () => import('@/lib/themes/registry-client');


// ============================================================================
// Request bodies
// ============================================================================

const requiredString = (field: string) =>
  z.string({ error: `Missing or invalid "${field}" field` }).min(1, `Missing or invalid "${field}" field`);

const urlString = requiredString('url').refine((value) => URL.canParse(value), 'Invalid URL format');

const installFromUrlSchema = z.object({ url: urlString });
const addSourceSchema = z.object({
  url: urlString,
  name: z.string().optional(),
  publicKey: z.string().optional(),
});
const removeSourceSchema = z.object({ name: requiredString('name') });
const installRegistrySchema = z.object({
  themeId: requiredString('themeId'),
  registryUrl: requiredString('registryUrl'),
});

/**
 * Read an action's JSON body against its schema. The answer is the parsed
 * body, or the 400 to return: unparseable JSON, or the first thing wrong
 * with it, in the schema's own words.
 */
async function readBody<T>(request: NextRequest, schema: z.ZodType<T>): Promise<T | NextResponse> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest('Invalid JSON body');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Invalid request body';
    logger.debug('Refused a theme action body', { context: 'themes-api', message });
    return badRequest(message);
  }
  return parsed.data;
}

async function ensureInitialized() {
  const { isPluginSystemInitialized, initializePlugins } = await getPluginInit();
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

    return await dispatchAction(
      request,
      {
        registry: () => handleGetRegistry(request),
        'registry-sources': () => handleGetRegistrySources(),
        updates: () => handleGetUpdates(),
      },
      () => handleGetThemes()
    );
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
  const { themeRegistry } = await getThemeRegistry();
  const themes = themeRegistry.getThemeList();
  const refused = themeRegistry.getRefused();
  const stats = themeRegistry.getStats();
  logger.debug('Listing themes', { context: 'themes-api', count: themes.length, refused: refused.length });
  return successResponse({
    themes,
    refused,
    stats: {
      total: stats.total,
      withDarkMode: stats.withDarkMode,
      refused: stats.refused,
    },
  });
}

/**
 * Register a freshly installed bundle with the running registry, so it can be
 * worn without a restart.
 */
async function hotLoadInstalledTheme(themeId: string | undefined): Promise<void> {
  const { hotLoadInstalledTheme: hotLoad } = await import('@/lib/themes/hot-load');
  await hotLoad(themeId);
}

/** The 400 for a failed install: an earlier theme's refusal speaks for itself. */
function installFailure(prefix: string, result: { error?: string; refused?: { message: string } }) {
  if (result.refused) return badRequest(result.refused.message);
  return badRequest(`${prefix}: ${result.error}`);
}

/**
 * GET ?action=registry — browse themes from all enabled registries
 */
async function handleGetRegistry(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q') || '';

  // searchThemes uses cached indexes (with 1-hour TTL), returning all if query is empty
  const { searchThemes } = await getRegistryClient();
  const themes = await searchThemes(query);

  return successResponse({ themes });
}

/**
 * GET ?action=registry-sources — list configured registries
 */
async function handleGetRegistrySources() {
  const { getSources } = await getRegistryClient();
  const sources = await getSources();
  return successResponse({ sources });
}

/**
 * GET ?action=updates — check for available theme updates
 */
async function handleGetUpdates() {
  const { checkForUpdates } = await getRegistryClient();
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

    return await dispatchAction(request, {
      install: () => handleInstall(request),
      'install-from-url': () => handleInstallFromUrl(request),
      'add-source': () => handleAddSource(request),
      'remove-source': () => handleRemoveSource(request),
      refresh: () => handleRefresh(),
      'install-registry': () => handleInstallFromRegistryAction(request),
    });
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

  // Dynamic imports to avoid Turbopack tracing fs operations
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const os = await import('node:os');
  const { installThemeBundle } = await getBundleLoader();

  // Write to temp file
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qtap-theme-upload-'));
  // The upload's filename is caller-supplied: only its last segment is kept
  // (the validator names an id-less bundle after it), never a path.
  const uploadName = path.basename(file.name || '');
  const tempFile = path.join(
    tempDir,
    uploadName && uploadName !== '.' && uploadName !== '..' ? uploadName : 'theme.qtap-theme'
  );

  try {
    const arrayBuffer = await file.arrayBuffer();
    await fs.writeFile(tempFile, Buffer.from(arrayBuffer));

    const result = await installThemeBundle(tempFile);

    if (!result.success) {
      return installFailure('Theme installation failed', result);
    }

    await hotLoadInstalledTheme(result.themeId);

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
  const body = await readBody(request, installFromUrlSchema);
  if (body instanceof NextResponse) return body;

  const { installThemeBundleFromUrl } = await getBundleLoader();
  const result = await installThemeBundleFromUrl(body.url);

  if (!result.success) {
    return installFailure('Theme installation failed', result);
  }

  await hotLoadInstalledTheme(result.themeId);

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
  const body = await readBody(request, addSourceSchema);
  if (body instanceof NextResponse) return body;

  try {
    const { addSource } = await getRegistryClient();
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
  const body = await readBody(request, removeSourceSchema);
  if (body instanceof NextResponse) return body;

  const { removeSource } = await getRegistryClient();
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
  const { refreshAllRegistries } = await getRegistryClient();
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
  const body = await readBody(request, installRegistrySchema);
  if (body instanceof NextResponse) return body;

  const { installFromRegistry } = await getRegistryClient();
  const result = await installFromRegistry(body.themeId, body.registryUrl);

  if (!result.success) {
    return installFailure('Registry installation failed', result);
  }

  await hotLoadInstalledTheme(result.themeId);

  return created({
    message: 'Theme installed from registry',
    themeId: result.themeId,
    version: result.version,
  });
}
