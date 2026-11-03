/**
 * Inline Brahma connection-profile resolution.
 *
 * Decides which connection profile (model) answers an inline `@Brahma:` /
 * `@Brahma?` consultation from inside a Salon chat. This is the one place that
 * order is spelt out:
 *
 *  1. the chat's project's `brahmaConnectionProfileId` (project properties.json),
 *  2. the global `brahmaConsole.inlineConnectionProfileId` instance setting,
 *  3. the user's default connection profile.
 *
 * A configured id that no longer names a profile the user owns falls through to
 * the next step with a warning — a deleted profile never leaves Brahma mute.
 *
 * The standalone Brahma Console does not come through here: it has its own
 * per-chat picker (`resolveBrahmaConnectionProfile`).
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { getBrahmaConsoleSettings } from '@/lib/instance-settings'
import type { getRepositories } from '@/lib/repositories/factory'
import type { ConnectionProfile } from '@/lib/schemas/types'

const logger = createServiceLogger('BrahmaInlineProfile')

type Repos = ReturnType<typeof getRepositories>

/** Look up a configured profile id; null (with a warning) when it is stale. */
async function findConfiguredProfile(
  repos: Repos,
  userId: string,
  profileId: string,
  source: 'project' | 'global',
  context: Record<string, unknown>,
): Promise<ConnectionProfile | null> {
  const profile = await repos.connections.findById(profileId)
  if (profile && profile.userId === userId) return profile
  logger.warn('Inline Brahma connection profile no longer exists; falling through', {
    source,
    profileId,
    ...context,
  })
  return null
}

/**
 * Resolve the connection profile an inline Brahma query in `chatId` should use.
 * Returns null only when no step resolves (the user has no profiles at all).
 */
export async function resolveInlineBrahmaConnectionProfile(
  repos: Repos,
  userId: string,
  chatId: string,
): Promise<ConnectionProfile | null> {
  // 1. Project override
  let projectId: string | null = null
  try {
    const chat = await repos.chats.findById(chatId)
    projectId = chat?.projectId ?? null
  } catch (error) {
    logger.warn('Could not read chat for inline Brahma profile resolution; skipping project override', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  if (projectId) {
    try {
      const project = await repos.projects.findById(projectId)
      const projectProfileId = project?.brahmaConnectionProfileId ?? null
      if (projectProfileId) {
        const profile = await findConfiguredProfile(repos, userId, projectProfileId, 'project', { chatId, projectId })
        if (profile) {
          logger.debug('Inline Brahma using project connection profile', { chatId, projectId, profileId: profile.id })
          return profile
        }
      }
    } catch (error) {
      logger.warn('Could not read project for inline Brahma profile resolution; skipping project override', {
        chatId,
        projectId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // 2. Global instance setting
  let globalProfileId: string | null = null
  try {
    const settings = await getBrahmaConsoleSettings()
    globalProfileId = settings.inlineConnectionProfileId ?? null
  } catch (error) {
    logger.warn('Could not read Brahma Console settings; skipping global inline profile', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  if (globalProfileId) {
    const profile = await findConfiguredProfile(repos, userId, globalProfileId, 'global', { chatId })
    if (profile) {
      logger.debug('Inline Brahma using global connection profile', { chatId, profileId: profile.id })
      return profile
    }
  }

  // 3. The user's default profile
  const fallback = await repos.connections.findDefault(userId)
  logger.debug('Inline Brahma using default connection profile', { chatId, profileId: fallback?.id ?? null })
  return fallback
}
