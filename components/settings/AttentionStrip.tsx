'use client'

/**
 * The attention strip — a row of chips above the Settings rail, one per
 * condition the page can already know, in a fixed order:
 *
 *  1. a connection, image or embedding profile whose key is missing or whose
 *     provider plugin is absent;
 *  2. the Concierge off duty;
 *  3. memories awaiting an embedding backfill;
 *  4. a failed background task;
 *  5. a plugin that failed to load.
 *
 * Each chip names the condition and links to the card that fixes it. Nothing
 * lit, nothing rendered. The queries are the cards' own (same `queryKeys`, same
 * URLs), so the cache is shared with them. `useAttentionChips` also feeds the
 * default-group rule: `/settings` with no parameters opens the first lit
 * chip's group.
 *
 * @module components/settings/AttentionStrip
 */

import { useMemo } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { getSettingsCard, settingsCardHref, type SettingsGroupId } from '@/lib/settings/registry'
import { useChatSettingsContext } from '@/components/settings/chat-settings/ChatSettingsProvider'
import { mergeConciergeSettings } from '@/components/settings/concierge-settings/merge'
import { Icon } from '@/components/ui/icon'

export type AttentionConditionId =
  | 'profile-key'
  | 'concierge-off-duty'
  | 'memory-backfill'
  | 'failed-task'
  | 'plugin-error'

export interface AttentionChip {
  id: AttentionConditionId
  label: string
  /** The card that fixes it. */
  card: string
  group: SettingsGroupId
  /** For a missing-key chip with one troubled provider: the provider card to open. */
  provider?: string
}

interface ApiKeyRow {
  id: string
  provider: string
}

interface ProfileRow {
  id: string
  name: string
  provider: string
  apiKeyId?: string | null
}

interface ProviderRow {
  name: string
  configRequirements?: { requiresApiKey?: boolean }
}

function chip(id: AttentionConditionId, label: string, cardId: string): AttentionChip {
  const card = getSettingsCard(cardId)
  if (!card) throw new Error(`Attention chip ${id} points at unregistered card ${cardId}`)
  // A hosted card's chip opens its host (the Providers card) — the missing key
  // is fixed from the provider's own card.
  const target = card.hostedBy ? getSettingsCard(card.hostedBy)! : card
  return { id, label, card: target.id, group: target.group }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Profiles that cannot work as configured: a key that is gone, a required key never given, a provider plugin absent. */
export function findTroubledProfiles(input: {
  apiKeys: ApiKeyRow[] | undefined
  providers: ProviderRow[] | undefined
  connectionProfiles: ProfileRow[]
  imageProfiles: ProfileRow[]
  embeddingProfiles: ProfileRow[]
}): ProfileRow[] {
  const { apiKeys, providers } = input
  if (!apiKeys) return []
  const keyIds = new Set(apiKeys.map((k) => k.id))
  const providerByName = providers ? new Map(providers.map((p) => [p.name, p])) : null
  const missingKey = (p: ProfileRow) => !!p.apiKeyId && !keyIds.has(p.apiKeyId)

  const troubled: ProfileRow[] = []
  for (const p of input.connectionProfiles) {
    const provider = providerByName?.get(p.provider)
    const pluginAbsent = providerByName !== null && !provider
    const keyRequiredButAbsent = !!provider?.configRequirements?.requiresApiKey && !p.apiKeyId
    if (missingKey(p) || pluginAbsent || keyRequiredButAbsent) troubled.push(p)
  }
  for (const p of [...input.imageProfiles, ...input.embeddingProfiles]) {
    if (missingKey(p)) troubled.push(p)
  }
  return troubled
}

export function useAttentionChips(): { chips: AttentionChip[]; ready: boolean } {
  const { settings, loading, connectionProfiles, imageProfiles, embeddingProfiles, loadingProfiles } =
    useChatSettingsContext()

  const apiKeys = useQuery({
    queryKey: queryKeys.apiKeys.all,
    queryFn: ({ signal }) => apiFetch<{ apiKeys: ApiKeyRow[] }>('/api/v1/api-keys', { signal }),
  })
  const providers = useQuery({
    queryKey: queryKeys.providers.all,
    queryFn: ({ signal }) => apiFetch<{ providers?: ProviderRow[] }>('/api/v1/providers', { signal }),
    staleTime: Infinity,
  })
  const backfill = useQuery({
    queryKey: queryKeys.memories.backfillProgress,
    queryFn: ({ signal }) =>
      apiFetch<{ progress: { remaining: number; inFlight: number } }>(
        '/api/v1/memories?action=backfill-embeddings',
        { signal },
      ),
  })
  const tasks = useQuery({
    queryKey: queryKeys.system.tasksQueue,
    queryFn: ({ signal }) =>
      apiFetch<{ stats: { failed: number } }>('/api/v1/system/tools?action=tasks-queue', { signal }),
  })
  const plugins = useQuery({
    queryKey: queryKeys.plugins.all,
    queryFn: ({ signal }) => apiFetch<{ errors?: unknown[] }>('/api/v1/plugins', { signal }),
  })

  const ready =
    !loading &&
    !loadingProfiles &&
    !apiKeys.isLoading &&
    !providers.isLoading &&
    !backfill.isLoading &&
    !tasks.isLoading &&
    !plugins.isLoading

  const chips = useMemo(() => {
    const lit: AttentionChip[] = []

    const troubled = findTroubledProfiles({
      apiKeys: apiKeys.data?.apiKeys,
      providers: providers.data?.providers,
      connectionProfiles: connectionProfiles as ProfileRow[],
      imageProfiles: imageProfiles as ProfileRow[],
      embeddingProfiles: embeddingProfiles as ProfileRow[],
    })
    if (troubled.length > 0) {
      const providers = new Set(troubled.map((p) => p.provider))
      lit.push({
        ...chip(
          'profile-key',
          troubled.length === 1
            ? `“${troubled[0].name}” is missing its key or provider`
            : `${plural(troubled.length, 'profile is', 'profiles are')} missing a key or provider`,
          'api-keys',
        ),
        ...(providers.size === 1 ? { provider: troubled[0].provider } : {}),
      })
    }

    if (settings && !mergeConciergeSettings(settings.conciergeSettings).enabled) {
      lit.push(chip('concierge-off-duty', 'The Concierge is off duty', 'on-duty'))
    }

    const remaining = backfill.data?.progress?.remaining ?? 0
    if (remaining > 0) {
      lit.push(chip('memory-backfill', `${plural(remaining, 'memory awaits', 'memories await')} an embedding`, 'memory-backfill'))
    }

    const failed = tasks.data?.stats?.failed ?? 0
    if (failed > 0) {
      lit.push(chip('failed-task', `${plural(failed, 'background task has', 'background tasks have')} failed`, 'tasks-queue'))
    }

    const pluginErrors = plugins.data?.errors?.length ?? 0
    if (pluginErrors > 0) {
      lit.push(chip('plugin-error', `${plural(pluginErrors, 'plugin needs', 'plugins need')} attention`, 'plugins'))
    }

    return lit
  }, [
    apiKeys.data,
    providers.data,
    connectionProfiles,
    imageProfiles,
    embeddingProfiles,
    settings,
    backfill.data,
    tasks.data,
    plugins.data,
  ])

  return { chips, ready }
}

export function AttentionStrip({
  chips,
  onSelect,
}: {
  chips: AttentionChip[]
  /** Open the chip's card in place (the page owns navigation inside itself). */
  onSelect?: (chip: AttentionChip) => void
}) {
  if (chips.length === 0) return null
  return (
    <ul className="qt-settings-attention" aria-label="Settings that need attention">
      {chips.map((c) => (
        <li key={c.id}>
          <Link
            href={c.provider ? `${settingsCardHref(c.card)}&provider=${encodeURIComponent(c.provider)}` : settingsCardHref(c.card)}
            className="qt-settings-attention-chip"
            data-condition={c.id}
            onClick={(e) => {
              if (!onSelect) return
              e.preventDefault()
              onSelect(c)
            }}
          >
            <Icon name="alert-triangle" className="w-4 h-4" />
            <span>{c.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
