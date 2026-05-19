/**
 * Shared helpers for resolving decrypted API keys from the connection-profile
 * + api-key tables. Centralizes the lookup so the cheap-LLM selection path
 * (used by both `cheap-llm-tasks/core-execution.ts` and
 * `services/dangerous-content/gatekeeper.service.ts`) doesn't carry a
 * duplicated implementation.
 *
 * `pricing-fetcher`'s `getApiKeyForProvider` and `embedding-service`'s
 * `getApiKeyForProfile` operate on different inputs (a list of profiles
 * filtered by provider; an embedding profile already in hand) and stay
 * specialized.
 */

import { getRepositories } from '@/lib/repositories/factory'
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm'

/**
 * Resolve the decrypted API key for a connection profile by ID.
 * Returns null when the profile, its `apiKeyId`, or the key record itself
 * is missing.
 */
export async function getApiKeyForConnectionProfile(
  profileId: string,
  userId: string,
): Promise<string | null> {
  const repos = getRepositories()
  const profile = await repos.connections.findById(profileId)
  if (!profile?.apiKeyId) return null
  const apiKey = await repos.connections.findApiKeyByIdAndUserId(profile.apiKeyId, userId)
  return apiKey?.key_value ?? null
}

/**
 * Resolve the decrypted API key for a cheap-LLM selection.
 * Returns '' for selections that target a local model (no key needed),
 * and null when the selection has no profile or the lookup fails.
 */
export async function getApiKeyForCheapLLMSelection(
  selection: CheapLLMSelection,
  userId: string,
): Promise<string | null> {
  if (selection.isLocal) return ''
  if (!selection.connectionProfileId) return null
  return getApiKeyForConnectionProfile(selection.connectionProfileId, userId)
}
