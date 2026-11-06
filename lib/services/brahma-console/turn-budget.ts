import { getBrahmaConsoleSettings } from '@/lib/instance-settings'
import { DEFAULT_BRAHMA_MAX_AGENT_TURNS } from '@/lib/schemas/settings.types'
import { logger } from '@/lib/logger'

/** Fallback agent-turn budget when the setting is unset or unreadable (10). */
export { DEFAULT_BRAHMA_MAX_AGENT_TURNS }

/**
 * Resolve the Brahma Console's per-query agent-turn budget (Settings → Chat →
 * Brahma Console). Shared by both the streaming orchestrator and the one-shot
 * `@Brahma` path so they always agree. Never throws — falls back to the
 * documented default if the setting is unreadable.
 *
 * The operator's figure is the only ceiling on tool-use rounds — no upper
 * bound is applied here. The duplicate/stale-query guard in the loop is
 * independent and still stops a stuck loop well before it.
 */
export async function resolveBrahmaMaxAgentTurns(): Promise<number> {
  try {
    const settings = await getBrahmaConsoleSettings()
    const turns = settings.maxAgentTurns ?? DEFAULT_BRAHMA_MAX_AGENT_TURNS
    logger.debug('Resolved Brahma Console agent-turn budget', { context: 'brahma-console.turn-budget', turns })
    return turns
  } catch (error) {
    logger.warn('Brahma Console turn budget unreadable; using default', {
      context: 'brahma-console.turn-budget',
      default: DEFAULT_BRAHMA_MAX_AGENT_TURNS,
      error: error instanceof Error ? error.message : String(error),
    })
    return DEFAULT_BRAHMA_MAX_AGENT_TURNS
  }
}
