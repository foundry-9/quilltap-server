/**
 * Theme Item API Routes (v1)
 *
 * GET    /api/v1/themes/:themeId              - Get theme metadata
 * GET    /api/v1/themes/:themeId?action=tokens - Get tokens for a specific theme
 * GET    /api/v1/themes/:themeId?action=export - Export theme as .qtap-theme download
 * DELETE /api/v1/themes/:themeId              - Uninstall a bundle theme
 */

import { NextRequest, NextResponse } from 'next/server';
import { themeRegistry } from '@/lib/themes/theme-registry';
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup/plugin-initialization';
import { logger } from '@/lib/logger';
import { successResponse, notFound, badRequest, serverError, messageResponse } from '@/lib/api/responses';
import { uninstallThemeBundle, exportThemeAsBundle } from '@/lib/themes/bundle-loader';
import type { QtapThemeManifest } from '@/lib/themes/types';
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
 * Returns the tokens and fonts for a specific theme
 */
async function handleGetTokens(themeId: string): Promise<Response> {
  if (!themeRegistry.has(themeId)) {
    return notFound('Theme');
  }

  const theme = themeRegistry.get(themeId);
  const tokens = themeRegistry.getTokens(themeId);
  const loadedFonts = themeRegistry.getFonts(themeId);
  const cssOverrides = themeRegistry.getCSSOverrides(themeId);

  const fonts = loadedFonts.map(font => ({
    family: font.family,
    src: font.isEmbedded && font.embeddedData
      ? font.embeddedData
      : `/api/themes/fonts/${font.pluginName}/${font.src}`,
    weight: font.weight,
    style: font.style,
    display: font.display,
  }));

  const subsystems = theme?.subsystems || undefined;

  return successResponse({ tokens, fonts, cssOverrides, subsystems });
}

/**
 * Handle GET ?action=export
 * Export any theme as a .qtap-theme bundle download
 */
async function handleExport(themeId: string): Promise<Response> {
  const theme = themeRegistry.get(themeId);
  if (!theme) {
    return notFound('Theme');
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qtap-theme-export-'));
  const outputPath = path.join(tempDir, `${themeId}.qtap-theme`);

  try {
    const manifest: QtapThemeManifest = {
      format: 'qtap-theme',
      formatVersion: 1,
      id: theme.id,
      name: theme.name,
      description: theme.description,
      version: theme.version,
      author: theme.author,
      supportsDarkMode: theme.supportsDarkMode,
      tags: theme.tags,
      tokens: theme.tokens,
    };

    const fonts = theme.fonts?.map(f => ({
      src: f.src,
      filePath: f.filePath,
      family: f.family,
      weight: f.weight,
      style: f.style,
      display: f.display,
    }));

    await exportThemeAsBundle(themeId, outputPath, {
      manifest,
      tokens: theme.tokens,
      cssOverrides: theme.cssOverrides,
      fonts,
      installPath: theme.bundlePath,
    });

    const fileBuffer = await fs.readFile(outputPath);

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${themeId}.qtap-theme"`,
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

    const action = request.nextUrl.searchParams.get('action');
    switch (action) {
      case 'tokens':
        return handleGetTokens(themeId);
      case 'export':
        return handleExport(themeId);
      case null:
        return handleDefaultGet(themeId);
      default:
        return badRequest(`Unknown action: ${action}`, {
          availableActions: ['tokens', 'export'],
        });
    }
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

    const theme = themeRegistry.get(themeId);
    if (!theme) {
      return notFound('Theme');
    }

    if (theme.source !== 'bundle') {
      return badRequest(
        `Cannot uninstall ${theme.source} theme "${theme.name}". Only bundle themes can be uninstalled.`
      );
    }

    logger.info('Uninstalling bundle theme', {
      context: 'DELETE /api/v1/themes/[themeId]',
      themeId,
    });

    const result = await uninstallThemeBundle(themeId);
    if (!result.success) {
      return serverError(`Failed to uninstall theme: ${result.error}`);
    }

    // Hot-unload from registry
    themeRegistry.unregisterTheme(themeId);

    return messageResponse(`Theme "${theme.name}" uninstalled successfully`);
  } catch (error) {
    logger.error(
      'Failed to delete theme',
      { context: 'DELETE /api/v1/themes/[themeId]' },
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to uninstall theme');
  }
}
