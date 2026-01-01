/**
 * Theme Preference API Routes
 *
 * GET  /api/theme-preference - Get user's theme preference
 * PUT  /api/theme-preference - Update user's theme preference
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler, type AuthenticatedContext } from '@/lib/api/middleware';
import { themeRegistry } from '@/lib/themes/theme-registry';
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup/plugin-initialization';
import { logger } from '@/lib/logger';
import { ThemePreferenceSchema, type ThemePreference } from '@/lib/themes/types';

/**
 * GET /api/theme-preference
 * Get the authenticated user's theme preference
 *
 * Response format:
 * {
 *   activeThemeId: string | null;
 *   colorMode: 'light' | 'dark' | 'system';
 *   customOverrides?: Record<string, string>;
 * }
 */
export const GET = createAuthenticatedHandler(async (req: NextRequest, { user, repos }: AuthenticatedContext) => {
  try {
    logger.debug('Fetching theme preference', {
      context: 'GET /api/theme-preference',
      userId: user.id,
    });

    // Get user's chat settings
    let chatSettings = await repos.chatSettings.findByUserId(user.id);

    // If no settings exist, create with defaults
    if (!chatSettings) {
      chatSettings = await repos.chatSettings.updateForUser(user.id, {
        avatarDisplayMode: 'ALWAYS',
        avatarDisplayStyle: 'CIRCULAR',
        tagStyles: {},
        themePreference: {
          activeThemeId: null,
          colorMode: 'system',
          showNavThemeSelector: false,
        },
      });
    }

    // Extract theme preference (with fallback to defaults)
    const themePreference: ThemePreference = chatSettings?.themePreference ?? {
      activeThemeId: null,
      colorMode: 'system',
      showNavThemeSelector: false,
    };

    logger.debug('Theme preference retrieved', {
      context: 'GET /api/theme-preference',
      userId: user.id,
      activeThemeId: themePreference.activeThemeId,
      colorMode: themePreference.colorMode,
    });

    return NextResponse.json(themePreference);
  } catch (error) {
    logger.error(
      'Failed to get theme preference',
      { context: 'GET /api/theme-preference' },
      error instanceof Error ? error : undefined
    );
    return NextResponse.json(
      { error: 'Failed to retrieve theme preference' },
      { status: 500 }
    );
  }
});

/**
 * PUT /api/theme-preference
 * Update the authenticated user's theme preference
 *
 * Request body (partial update supported):
 * {
 *   activeThemeId?: string | null;
 *   colorMode?: 'light' | 'dark' | 'system';
 *   customOverrides?: Record<string, string>;
 * }
 *
 * Response format: Updated ThemePreference
 */
export const PUT = createAuthenticatedHandler(async (request: NextRequest, { user, repos }: AuthenticatedContext) => {
  try {
    const body = await request.json();

    logger.debug('Updating theme preference', {
      context: 'PUT /api/theme-preference',
      userId: user.id,
      body,
    });

    // Validate the incoming data
    const { activeThemeId, colorMode, customOverrides, showNavThemeSelector } = body;

    // Validate colorMode if provided
    if (colorMode !== undefined) {
      const validModes = ['light', 'dark', 'system'];
      if (!validModes.includes(colorMode)) {
        return NextResponse.json(
          { error: 'Invalid color mode. Must be one of: light, dark, system' },
          { status: 400 }
        );
      }
    }

    // Validate activeThemeId if provided (and not null)
    if (activeThemeId !== undefined && activeThemeId !== null) {
      // Ensure plugin/theme system is initialized
      if (!isPluginSystemInitialized()) {
        await initializePlugins();
      }

      if (!themeRegistry.has(activeThemeId)) {
        return NextResponse.json(
          { error: `Theme not found: ${activeThemeId}` },
          { status: 400 }
        );
      }
    }

    // Get current settings to merge with
    let chatSettings = await repos.chatSettings.findByUserId(user.id);
    const currentPreference = chatSettings?.themePreference ?? {
      activeThemeId: null,
      colorMode: 'system',
      showNavThemeSelector: false,
    };

    // Build updated preference
    const updatedPreference: ThemePreference = {
      ...currentPreference,
      ...(activeThemeId !== undefined && { activeThemeId }),
      ...(colorMode !== undefined && { colorMode }),
      ...(customOverrides !== undefined && { customOverrides }),
      ...(showNavThemeSelector !== undefined && { showNavThemeSelector }),
    };

    // Validate the complete preference
    const validationResult = ThemePreferenceSchema.safeParse(updatedPreference);
    if (!validationResult.success) {
      logger.warn('Theme preference validation failed', {
        context: 'PUT /api/theme-preference',
        userId: user.id,
        errors: validationResult.error.errors,
      });
      return NextResponse.json(
        { error: 'Invalid theme preference data' },
        { status: 400 }
      );
    }

    // Update chat settings with new theme preference
    chatSettings = await repos.chatSettings.updateForUser(user.id, {
      themePreference: validationResult.data,
    });

    if (!chatSettings) {
      return NextResponse.json(
        { error: 'Failed to update theme preference' },
        { status: 500 }
      );
    }

    logger.info('Theme preference updated', {
      context: 'PUT /api/theme-preference',
      userId: user.id,
      activeThemeId: validationResult.data.activeThemeId,
      colorMode: validationResult.data.colorMode,
    });

    return NextResponse.json(validationResult.data);
  } catch (error) {
    logger.error(
      'Failed to update theme preference',
      { context: 'PUT /api/theme-preference' },
      error instanceof Error ? error : undefined
    );
    return NextResponse.json(
      { error: 'Failed to update theme preference' },
      { status: 500 }
    );
  }
});
