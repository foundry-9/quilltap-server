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
import {
  initializePlugins,
  isPluginSystemInitialized,
} from '@/lib/startup';
import { providerRegistry } from '@/lib/plugins/provider-registry';

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedHandler(async (req, context) => {
  try {
    logger.debug('[Providers v1] GET list', { userId: context.user.id });

    // Ensure plugin system is initialized
    if (!isPluginSystemInitialized() || !providerRegistry.isInitialized()) {
      const initResult = await initializePlugins();
      if (!initResult.success) {
        logger.warn('[Providers v1] Plugin initialization failed');
        return serverError('Plugin system not ready');
      }
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
