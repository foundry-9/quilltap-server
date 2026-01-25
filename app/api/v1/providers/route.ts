/**
 * Providers API v1
 *
 * GET /api/v1/providers - List available LLM providers
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import {
  serverError,
  successResponse,
} from '@/lib/api/responses';
import { providerRegistry, hotLoadProviderPlugin } from '@/lib/plugins/provider-registry';
import { scanPlugins } from '@/lib/plugins/manifest-loader';

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedHandler(async (req, context) => {
  try {

    // Lazy-load user's LLM provider plugins (not loaded at startup)
    try {
      const userPlugins = await scanPlugins(undefined, context.user.id);
      for (const plugin of userPlugins.plugins) {
        if (plugin.manifest.capabilities.includes('LLM_PROVIDER')) {
          // Try to hot-load if not already registered
          if (!providerRegistry.hasProvider(plugin.manifest.providerConfig?.providerName || '')) {hotLoadProviderPlugin(plugin.pluginPath, plugin.manifest);
          }
        }
      }
    } catch (error) {
      logger.warn('[Providers v1] Failed to scan user plugins for lazy-loading', {
        userId: context.user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue anyway - user plugins are optional
    }

    // Get all registered providers
    const plugins = providerRegistry.getAllProviders();

    // Transform to response format
    const providerList = plugins.map((plugin) => ({
      id: plugin.metadata.providerName,
      name: plugin.metadata.providerName,
      displayName: plugin.metadata.displayName,
      description: plugin.metadata.description,
      abbreviation: plugin.metadata.abbreviation,
      colors: plugin.metadata.colors,
      type: 'llm',
      capabilities: plugin.capabilities,
      configRequirements: plugin.config,
    }));

    logger.info('[Providers v1] Listed providers', {
      count: providerList.length,
    });

    return successResponse({
      providers: providerList,
      count: providerList.length,
    });
  } catch (error) {
    logger.error(
      '[Providers v1] Error listing providers',
      {},
      error instanceof Error ? error : undefined
    );
    return serverError('Failed to fetch providers');
  }
});
