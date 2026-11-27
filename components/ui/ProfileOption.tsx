'use client'

/**
 * One `<option>` for a profile picker (connection or image profile), with the
 * "⚠️ No API Key" warning when — and only when — the profile has no key and
 * its provider requires one (`providerRequiresApiKey`, the same rule the
 * profile cards use). A provider the list does not know (not loaded yet, or a
 * plugin gone) is treated as requiring one.
 *
 * @module components/ui/ProfileOption
 */

import { useProvidersQuery } from '@/lib/hooks/use-profiles'
import { providerRequiresApiKey, type ApiKeyConfigRequirements } from '@/lib/llm/api-key-support'

interface ProviderKeyRow {
  name: string
  configRequirements?: ApiKeyConfigRequirements
}

const keylessProviderNames = (rows: ProviderKeyRow[]): Set<string> =>
  new Set(rows.filter((p) => !providerRequiresApiKey(p.configRequirements)).map((p) => p.name))

const NO_KEYLESS = new Set<string>()

export interface ProfileOptionProps {
  profile: {
    id: string
    name: string
    provider: string
    modelName: string
    apiKey?: unknown
  }
  /** The visible text before the warning. Default: `Name (PROVIDER • model)`. */
  label?: string
}

export function ProfileOption({ profile, label }: ProfileOptionProps) {
  const { data: keyless = NO_KEYLESS } = useProvidersQuery<ProviderKeyRow, Set<string>>({
    select: keylessProviderNames,
    staleTime: Infinity,
  })
  const missingKey = !profile.apiKey && !keyless.has(profile.provider)
  const text = label ?? `${profile.name} (${profile.provider} • ${profile.modelName})`
  return (
    <option value={profile.id}>
      {text}
      {missingKey ? ' ⚠️ No API Key' : ''}
    </option>
  )
}
