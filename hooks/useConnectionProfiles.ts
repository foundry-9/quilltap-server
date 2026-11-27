'use client'

import { useConnectionProfilesQuery } from '@/lib/hooks/use-profiles'
import { orderProfilesByChatUse } from '@/lib/llm/profile-usage'

export interface ConnectionProfileInfo {
  id: string
  name: string
  provider: string
  modelName: string
  /** The user's default chat profile. */
  isDefault: boolean
  /** False when the profile has tool use switched off. */
  allowToolUse: boolean
  /** Whether the profile may offer the `search_web` tool. */
  allowWebSearch: boolean
}

function mapProfiles(rows: Array<Record<string, unknown>>): ConnectionProfileInfo[] {
  return rows.map((p) => ({
    id: p.id as string,
    name: (p.name as string) || '',
    provider: (p.provider as string) || '',
    modelName: (p.modelName as string) || '',
    isDefault: p.isDefault === true,
    allowToolUse: p.allowToolUse !== false,
    allowWebSearch: p.allowWebSearch === true,
  }))
}

/** The chat pickers' order: most used for chat first (lib/llm/profile-usage.ts). */
function mapProfilesByChatUse(rows: Array<Record<string, unknown>>): ConnectionProfileInfo[] {
  return mapProfiles(orderProfilesByChatUse(rows))
}

const EMPTY_PROFILES: ConnectionProfileInfo[] = []

/**
 * The connection profiles as display info, with an id → provider/model
 * lookup. A narrowing `select` over the shared list
 * (`useConnectionProfilesQuery`), so a profile written anywhere that
 * invalidates the list shows here; the long staleTime only spares re-reads
 * between writes.
 */
export function useConnectionProfiles(options: {
  /**
   * `'chat-use'` puts the profiles most used for chat first — for pickers that
   * choose a chat's (or a character's chat) profile. Default: the operator's
   * own order from Settings.
   */
  order?: 'settings' | 'chat-use'
} = {}) {
  const { data: profiles = EMPTY_PROFILES, isLoading: loading } = useConnectionProfilesQuery<
    Record<string, unknown>,
    ConnectionProfileInfo[]
  >({ select: options.order === 'chat-use' ? mapProfilesByChatUse : mapProfiles, staleTime: Infinity })

  return {
    profiles,
    loading,
    getProfileProvider(id: string): { provider: string; modelName: string; name: string } | null {
      const profile = profiles.find(p => p.id === id)
      if (!profile) return null
      return { provider: profile.provider, modelName: profile.modelName, name: profile.name }
    },
  }
}
