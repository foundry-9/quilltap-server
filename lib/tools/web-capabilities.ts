/**
 * Web capabilities — what a research surface could reach on the web for this
 * user, independent of any connection profile: a search provider that has the
 * API key it needs, and a curl plugin with at least one allowed URL pattern.
 *
 * Shared by the Scenario Builder and the wardrobe's Import from Instructions,
 * whose dialogs warn (rather than block) when the wider world is out of reach.
 *
 * Server-only.
 *
 * @module tools/web-capabilities
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { toolRegistry } from '@/lib/plugins/tool-registry'
import type { getRepositories } from '@/lib/repositories/factory'
import { isWebSearchConfigured } from '@/lib/tools/handlers/web-search-handler'

const logger = createServiceLogger('WebCapabilities')

/** The curl plugin's config row name. */
const CURL_PLUGIN_NAME = 'qtap-plugin-curl'

export interface WebCapabilities {
  /** A search provider is registered and has its API key, so `search_web` can work on a profile that allows it. */
  webSearchConfigured: boolean
  /** The curl plugin is installed with at least one allowed URL pattern. */
  curlConfigured: boolean
}

/** Never throws: a failed curl lookup reads as "curl unavailable". */
export async function resolveWebCapabilities(
  repos: ReturnType<typeof getRepositories>,
  userId: string,
): Promise<WebCapabilities> {
  const webSearchConfigured = await isWebSearchConfigured(userId)
  let curlConfigured = false
  try {
    if (toolRegistry.hasPlugin('curl')) {
      const config = await repos.pluginConfigs.findByUserAndPlugin(userId, CURL_PLUGIN_NAME)
      const patterns = (config?.config as { allowedUrlPatterns?: unknown } | undefined)?.allowedUrlPatterns
      curlConfigured = Array.isArray(patterns) && patterns.length > 0
    }
  } catch (error) {
    logger.warn('Curl capability lookup failed; treating curl as unavailable', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  logger.debug('Resolved web capabilities', { webSearchConfigured, curlConfigured })
  return { webSearchConfigured, curlConfigured }
}
