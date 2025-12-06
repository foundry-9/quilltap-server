import { NextResponse } from 'next/server'
import { pluginRegistry } from '@/lib/plugins/registry'
import { initializePlugins, isPluginSystemInitialized } from '@/lib/startup/plugin-initialization'
import { logger } from '@/lib/logger'

/**
 * GET /api/plugins
 * Get all registered plugins
 */
export async function GET() {
  try {
    // Ensure plugins are initialized before returning registry state
    // This handles cases where the API request arrives before instrumentation completes
    // or when running in development mode with hot-reload
    if (!isPluginSystemInitialized()) {
      logger.info('Plugin system not initialized, initializing now', {
        context: 'plugins-GET',
      })
      await initializePlugins()
    }

    const state = pluginRegistry.exportState()

    return NextResponse.json({
      plugins: state.plugins,
      stats: state.stats,
      errors: state.errors,
    })
  } catch (error) {
    logger.error('Failed to get plugins', { error })
    return NextResponse.json(
      { error: 'Failed to retrieve plugins' },
      { status: 500 }
    )
  }
}
