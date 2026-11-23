/**
 * Theme Item API Routes (v1)
 *
 * GET    /api/v1/themes/:themeId              - Get theme metadata
 * GET    /api/v1/themes/:themeId?action=tokens - What the client needs to apply a theme
 * GET    /api/v1/themes/:themeId?action=export - Export theme as .qtap-theme download
 * DELETE /api/v1/themes/:themeId              - Uninstall a bundle theme (or a refused one)
 */

import { NextRequest, NextResponse } from 'next/server';
import { themeRegistry } from '@/lib/themes/theme-registry';
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup/plugin-initialization';
import { logger } from '@/lib/logger';
import { buildContentDisposition } from '@/lib/api/content-disposition';
import { successResponse, notFound, badRequest, serverError, messageResponse } from '@/lib/api/responses';
import { dispatchAction } from '@/lib/api/middleware/actions';
import { uninstallThemeBundle, exportThemeAsBundle } from '@/lib/themes/bundle-loader';
import { compiledThemeCss } from '@/lib/themes/engine/compile';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';


async function ensureInitialized() {
  if (!isPluginSystemInitialized()) {
    logger.info('Plugin system not initialized, initializing now', {
      context: 'theme-item-api',
    });
    await initializePlugins();
  }
}

/**
 * Handle GET ?action=tokens
 * Returns what the client needs to apply a theme: its compiled CSS (font
 * faces, tokens, icons, scoped custom CSS, built and validated server-side),
 * its choices, the app-owned features it switches on, and its fonts, icons,
 * subsystem overrides and preview images. The default theme's CSS is empty:
 * the app's own stylesheet is the default.
 */
async function handleGetTokens(themeId: string): Promise<Response> {
  const theme = themeRegistry.get(themeId);
  if (!theme) {
    return notFound('Theme');
  }

  const fonts = themeRegistry.getFonts(themeId).map(font => ({
    family: font.family,
    src: `/api/themes/fonts/${font.pluginName}/${font.src}`,
    weight: font.weight,
    style: font.style,
    display: font.display,
  }));

  // Icon overrides resolve through the assets route (not the fonts route).
  // The assets route serves with `Cache-Control: immutable`, so the URL must
  // change when the theme changes — version the query string or browsers keep
  // serving a prior release's glyph from cache. The compiled override rules
  // (iconOverrides, lib/themes/engine/compile.ts) carry the same ?v= query.
  const iconVersion = encodeURIComponent(theme.version || '0');
  const icons = themeRegistry.getIcons(themeId).map(icon => ({
    name: icon.name,
    src: `/api/themes/assets/${icon.pluginName}/${icon.src}?v=${iconVersion}`,
  }));

  logger.debug('Serving theme', {
    context: 'theme-item-api',
    themeId,
    choices: theme.compiled?.choices,
    features: theme.compiled?.features,
  });
  return successResponse({
    css: theme.compiled ? compiledThemeCss(theme.compiled) : '',
    choices: theme.compiled?.choices ?? {},
    features: theme.compiled?.features ?? { pageBackground: false, focusRing: false, scrollbar: false },
    fonts,
    icons,
    subsystems: theme.subsystems || undefined,
    images: themeRegistry.getImages(themeId),
  });
}

/**
 * Handle GET ?action=export
 * Export a bundle theme as a .qtap-theme download
 */
async function handleExport(themeId: string): Promise<Response> {
  const theme = themeRegistry.get(themeId);
  if (!theme) {
    return notFound('Theme');
  }
  if (!theme.bundlePath) {
    return badRequest(`Theme "${theme.name}" is built in and has no bundle to export.`);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qtap-theme-export-'));
  const outputPath = path.join(tempDir, `${themeId}.qtap-theme`);

  try {
    await exportThemeAsBundle(themeId, theme.bundlePath, outputPath);
    const fileBuffer = await fs.readFile(outputPath);
    logger.debug('Exported theme bundle', { context: 'theme-item-api', themeId, bytes: fileBuffer.length });
    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': buildContentDisposition(`${themeId}.qtap-theme`, 'attachment'),
        'Content-Length': fileBuffer.length.toString(),
      },
    });
  } catch (error) {
    logger.error('Failed to export theme', {
      context: 'GET /api/v1/themes/[themeId]?action=export',
      themeId,
    }, error instanceof Error ? error : undefined);
    return serverError('Failed to export theme');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

/**
 * Default GET handler (no action specified)
 * Returns theme metadata
 */
async function handleDefaultGet(themeId: string): Promise<Response> {
  if (!themeRegistry.has(themeId)) {
    return notFound('Theme');
  }

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
    await ensureInitialized();
    const { themeId } = await params;

    return await dispatchAction(
      request,
      {
        tokens: () => handleGetTokens(themeId),
        export: () => handleExport(themeId),
      },
      () => handleDefaultGet(themeId)
    );
  } catch (error) {
    logger.error(
      'Failed to get theme',
      { context: 'GET /api/v1/themes/[themeId]' },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to retrieve theme');
  }
}

/**
 * DELETE /api/v1/themes/:themeId
 * Uninstall a bundle theme (refuses to delete plugin or default themes)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ themeId: string }> }
) {
  try {
    await ensureInitialized();
    const { themeId } = await params;

    // No actions on DELETE: an unknown `?action=` is a 400, never an uninstall.
    return await dispatchAction(request, {}, () => handleUninstall(themeId));
  } catch (error) {
    logger.error(
      'Failed to delete theme',
      { context: 'DELETE /api/v1/themes/[themeId]' },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to uninstall theme');
  }
}

/** Uninstall a bundle theme, or forget a refused one. */
async function handleUninstall(themeId: string): Promise<Response> {
  const theme = themeRegistry.get(themeId);
  const refused = theme ? null : themeRegistry.getRefusedTheme(themeId);
  if (!theme && !refused) {
    return notFound('Theme');
  }
  const name = theme?.name ?? refused!.name;

  if (refused && refused.source !== 'bundle') {
    return badRequest(
      `“${name}” arrives with a plugin; it departs when the plugin is removed from the Plugins card.`
    );
  }
  if (theme && theme.source !== 'bundle') {
    return badRequest(
      `Cannot uninstall ${theme.source} theme "${theme.name}". Only bundle themes can be uninstalled.`
    );
  }

  logger.info('Uninstalling bundle theme', {
    context: 'DELETE /api/v1/themes/[themeId]',
    themeId,
    refused: !!refused,
  });

  const result = await uninstallThemeBundle(themeId);
  if (!result.success) {
    return serverError(`Failed to uninstall theme: ${result.error}`);
  }

  if (refused) {
    themeRegistry.forgetRefused(themeId);
    return messageResponse(`Theme "${name}" uninstalled successfully`);
  }

  // Hot-unload from registry
  themeRegistry.unregisterTheme(themeId);

  return messageResponse(`Theme "${name}" uninstalled successfully`);
}
