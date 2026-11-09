'use client'

/**
 * Providers → *By provider* view (D10).
 *
 * One collapsible card per configured provider — a provider with a key, or one
 * any connection, image or embedding profile names — showing its keys (the
 * same rows, and the same Test / Delete actions, the API Keys card shows), then
 * every profile that uses it with a kind badge and a persona badge, and an Add
 * menu that opens the existing key / profile modals with the provider
 * preselected. An *Add a provider* card closes the list.
 *
 * Every list is read once, here, through the same `queryKeys` the rest of the
 * page uses; the per-provider cards are views over that one read. The modals
 * are the kind cards' own, hosted once at this level.
 *
 * @module components/settings/cards/providers-by-provider
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { getErrorMessage } from '@/lib/error-utils'
import { providerAcceptsApiKey } from '@/lib/llm/api-key-support'
import LoadingState from '@/components/ui/LoadingState'
import ErrorAlert from '@/components/ui/ErrorAlert'
import { Icon } from '@/components/ui/icon'
import { ItemActionMenu, type MenuEntryLike } from '@/components/item-browser/ItemActionMenu'
import { PersonaBadge } from '@/components/settings/PersonaBadge'
import type { SettingsPersona } from '@/lib/settings/registry'
import { ApiKeyModal } from '@/components/settings/api-keys/ApiKeyModal'
import { ApiKeyCard, type ApiKeyListItem } from '@/components/settings/api-keys/ApiKeyCard'
import { useApiKeyActions } from '@/components/settings/api-keys/hooks/useApiKeyActions'
import { useConnectionProfileModal } from '@/components/settings/connection-profiles/useConnectionProfileModal'
import type { ConnectionProfile, ProviderConfig } from '@/components/settings/connection-profiles/types'
import { ImageProfileModal } from '@/components/image-profiles/ImageProfileModal'
import { ProfileModal as EmbeddingProfileModal } from '@/components/settings/embedding-profiles/ProfileModal'
import { toEmbeddingProviderInfo } from '@/components/settings/embedding-profiles/hooks/useEmbeddingProfiles'
import type { EmbeddingModel, EmbeddingProfile } from '@/components/settings/embedding-profiles/types'
import {
  groupByProvider,
  PROVIDER_PROFILE_KIND_LABELS,
  type ProviderGroup,
  type ProviderProfileKind,
} from './provider-groups'

/** An image profile as `GET /api/v1/image-profiles` lists it. */
interface ImageProfile {
  id: string
  name: string
  provider: string
  apiKeyId?: string
  baseUrl?: string
  modelName: string
  parameters: Record<string, any>
  isDefault: boolean
  isDangerousCompatible?: boolean
}

/** A provider as `GET /api/v1/providers` lists it (LLM and search plugins alike). */
type ProviderListing = ProviderConfig & { type?: string }

type Group = ProviderGroup<ApiKeyListItem, ConnectionProfile, ImageProfile, EmbeddingProfile>

/** Who answers for each row kind (D1's persona mixing, inside one card). */
const KIND_PERSONA: Record<ProviderProfileKind, SettingsPersona> = {
  connection: 'forge',
  image: 'lantern',
  embedding: 'commonplace-book',
}

const EMPTY: never[] = []

/** The DOM id of a provider's card, so a link (an attention chip) can land on it. */
export function providerCardDomId(provider: string): string {
  return `provider-${provider.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}

type ModalRequest =
  | { kind: 'key'; provider?: string }
  | { kind: 'image'; provider?: string; profile?: ImageProfile }
  | { kind: 'embedding'; provider?: string; profile?: EmbeddingProfile }
  | null

export function ProvidersByProvider({ focusProvider }: { focusProvider?: string | null } = {}) {
  const queryClient = useQueryClient()

  // One read per list, shared with every other reader of the same key. Remounts
  // (switching back from *By kind*, whose lists write without the cache) refetch.
  const keysQuery = useQuery({
    queryKey: queryKeys.apiKeys.all,
    queryFn: ({ signal }) => apiFetch<{ apiKeys: ApiKeyListItem[] }>('/api/v1/api-keys', { signal }),
    refetchOnMount: 'always',
  })
  const connectionQuery = useQuery({
    queryKey: queryKeys.connectionProfiles.all,
    queryFn: ({ signal }) => apiFetch<{ profiles: ConnectionProfile[] }>('/api/v1/connection-profiles', { signal }),
    refetchOnMount: 'always',
  })
  const imageQuery = useQuery({
    queryKey: queryKeys.imageProfiles.all,
    queryFn: ({ signal }) => apiFetch<{ profiles: ImageProfile[] }>('/api/v1/image-profiles', { signal }),
    refetchOnMount: 'always',
  })
  const embeddingQuery = useQuery({
    queryKey: queryKeys.embeddingProfiles.all,
    queryFn: ({ signal }) => apiFetch<{ profiles: EmbeddingProfile[] }>('/api/v1/embedding-profiles', { signal }),
    refetchOnMount: 'always',
  })
  const providersQuery = useQuery({
    queryKey: queryKeys.providers.all,
    queryFn: ({ signal }) => apiFetch<{ providers: ProviderListing[] }>('/api/v1/providers', { signal }),
  })
  const embeddingProviderNamesQuery = useQuery({
    queryKey: queryKeys.embeddingProfiles.providerNames,
    queryFn: ({ signal }) =>
      apiFetch<{ providers: string[] }>('/api/v1/embedding-profiles?action=list-providers', { signal }),
  })

  const apiKeys = keysQuery.data?.apiKeys ?? EMPTY
  const connectionProfiles = connectionQuery.data?.profiles ?? EMPTY
  const imageProfiles = imageQuery.data?.profiles ?? EMPTY
  const embeddingProfiles = embeddingQuery.data?.profiles ?? EMPTY
  const providers = providersQuery.data?.providers ?? EMPTY
  const embeddingProviderNames = embeddingProviderNamesQuery.data?.providers

  const groups = useMemo(() => {
    const grouped = groupByProvider({
      keys: apiKeys,
      connection: connectionProfiles,
      image: imageProfiles,
      embedding: embeddingProfiles,
    })
    const label = (name: string) => providers.find((p) => p.name === name)?.displayName || name
    return grouped.sort((a, b) => label(a.provider).localeCompare(label(b.provider)))
  }, [apiKeys, connectionProfiles, imageProfiles, embeddingProfiles, providers])

  const displayName = useCallback(
    (name: string) => providers.find((p) => p.name === name)?.displayName || name,
    [providers],
  )

  // --- Modals: the kind cards' own, hosted once here -------------------------

  const refreshKeys = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys.all }),
    [queryClient],
  )
  const keyActions = useApiKeyActions(refreshKeys)

  const [request, setRequest] = useState<ModalRequest>(null)
  // Bumped per opening: the image and embedding modals seed their forms at
  // mount, so each opening gets a fresh one.
  const [openSeq, setOpenSeq] = useState(0)
  const open = useCallback((next: NonNullable<ModalRequest>) => {
    console.debug('[ProvidersByProvider] Opening modal', {
      kind: next.kind,
      provider: next.provider ?? null,
      editing: 'profile' in next && next.profile ? next.profile.id : null,
    })
    setOpenSeq((n) => n + 1)
    setRequest(next)
  }, [])
  const closeModal = useCallback(() => setRequest(null), [])

  const connectionModal = useConnectionProfileModal({
    profiles: connectionProfiles,
    apiKeys,
    providers,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.connectionProfiles.all })
      void refreshKeys()
    },
  })

  // The embedding modal's catalogue is read only once someone opens it.
  const wantsEmbeddingModal = request?.kind === 'embedding'
  const embeddingModelsQuery = useQuery({
    queryKey: queryKeys.embeddingProfiles.models,
    queryFn: ({ signal }) =>
      apiFetch<Record<string, EmbeddingModel[]>>('/api/v1/embedding-profiles?action=list-models', { signal }),
    enabled: wantsEmbeddingModal,
  })
  const embeddingProviders = useMemo(
    () => toEmbeddingProviderInfo(embeddingProviderNames ?? Object.keys(embeddingModelsQuery.data ?? {})),
    [embeddingProviderNames, embeddingModelsQuery.data],
  )
  const embeddingCatalogueSettled =
    !embeddingModelsQuery.isPending && !embeddingProviderNamesQuery.isPending

  // --- What the Add menu may offer for a provider ----------------------------

  const offers = useCallback(
    (provider: string): Record<'key' | ProviderProfileKind, boolean> => {
      const listing = providers.find((p) => p.name === provider)
      // A provider the list does not know (not loaded, or a plugin gone) is not
      // evidence against any kind; the modal's own picker has the last word.
      if (!listing) {
        return {
          key: true,
          connection: true,
          image: true,
          embedding: !embeddingProviderNames || embeddingProviderNames.includes(provider),
        }
      }
      const isLlm = (listing.type ?? 'llm') === 'llm'
      return {
        key: providerAcceptsApiKey(listing.configRequirements),
        connection: isLlm && listing.capabilities?.chat !== false,
        image: isLlm && listing.capabilities?.imageGeneration === true,
        embedding: embeddingProviderNames
          ? embeddingProviderNames.includes(provider)
          : listing.capabilities?.embeddings === true,
      }
    },
    [providers, embeddingProviderNames],
  )

  const loadError = keysQuery.error || connectionQuery.error || imageQuery.error || embeddingQuery.error
  const loading =
    keysQuery.isPending || connectionQuery.isPending || imageQuery.isPending || embeddingQuery.isPending

  if (loading && !loadError) {
    return <LoadingState message="Loading providers..." />
  }

  return (
    <div className="space-y-4">
      {loadError && (
        <ErrorAlert
          message={getErrorMessage(loadError, 'Failed to load providers')}
          onRetry={() => {
            void keysQuery.refetch()
            void connectionQuery.refetch()
            void imageQuery.refetch()
            void embeddingQuery.refetch()
          }}
        />
      )}

      {keyActions.deleteError && <ErrorAlert message={keyActions.deleteError} />}

      {groups.map((group) => (
        <ProviderCard
          key={group.provider}
          focused={!!focusProvider && focusProvider === group.provider}
          group={group}
          displayName={displayName(group.provider)}
          keyActions={keyActions}
          offers={offers(group.provider)}
          onAdd={(kind) => {
            if (kind === 'connection') {
              console.debug('[ProvidersByProvider] Opening modal', { kind, provider: group.provider })
              connectionModal.openNew(group.provider)
            } else {
              open({ kind, provider: group.provider })
            }
          }}
          onOpenProfile={(entry) => {
            if (entry.kind === 'connection') {
              console.debug('[ProvidersByProvider] Opening modal', { kind: 'connection', editing: entry.profile.id })
              connectionModal.openEdit(entry.profile)
            } else if (entry.kind === 'image') {
              open({ kind: 'image', profile: entry.profile })
            } else {
              open({ kind: 'embedding', profile: entry.profile })
            }
          }}
        />
      ))}

      <AddProviderCard hasProviders={groups.length > 0} onAddKey={() => open({ kind: 'key' })} />

      {/* The kind cards' modals, unchanged */}
      <ApiKeyModal
        isOpen={request?.kind === 'key'}
        onClose={closeModal}
        onSuccess={() => void refreshKeys()}
        initialProvider={request?.kind === 'key' ? request.provider : undefined}
      />

      {connectionModal.modal}

      {request?.kind === 'image' && (
        <ImageProfileModal
          key={`image-${openSeq}`}
          isOpen
          onClose={closeModal}
          onSuccess={() => void queryClient.invalidateQueries({ queryKey: queryKeys.imageProfiles.all })}
          profile={request.profile}
          apiKeys={apiKeys}
          initialProvider={request.provider}
        />
      )}

      {request?.kind === 'embedding' && embeddingCatalogueSettled && (
        <EmbeddingProfileModal
          key={`embedding-${openSeq}`}
          isOpen
          onClose={closeModal}
          onSuccess={() => void queryClient.invalidateQueries({ queryKey: queryKeys.embeddingProfiles.all })}
          profile={request.profile ?? null}
          apiKeys={apiKeys}
          embeddingModels={embeddingModelsQuery.data ?? {}}
          embeddingProviders={embeddingProviders}
          initialProvider={request.provider}
        />
      )}
    </div>
  )
}

// --- One provider -------------------------------------------------------------

interface ProviderCardProps {
  /** Open and scroll to this card on mount (an attention chip's target). */
  focused?: boolean
  group: Group
  displayName: string
  keyActions: ReturnType<typeof useApiKeyActions>
  offers: Record<'key' | ProviderProfileKind, boolean>
  onAdd: (kind: 'key' | ProviderProfileKind) => void
  onOpenProfile: (entry: Group['profiles'][number]) => void
}

function ProviderCard({ focused, group, displayName, keyActions, offers, onAdd, onOpenProfile }: ProviderCardProps) {
  const [isOpen, setIsOpen] = useState(!!focused)
  const sectionRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (focused) requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [focused])
  const domId = providerCardDomId(group.provider)
  const bodyId = `${domId}-body`
  const headingId = `${domId}-heading`

  const summary = [
    group.keys.length === 1 ? '1 key' : `${group.keys.length} keys`,
    group.profiles.length === 1 ? '1 profile' : `${group.profiles.length} profiles`,
  ].join(' · ')

  const entries: MenuEntryLike[] = [
    { key: 'key', label: 'API key', onSelect: () => onAdd('key'), disabled: !offers.key },
    { key: 'connection', label: 'Connection profile', onSelect: () => onAdd('connection'), disabled: !offers.connection },
    { key: 'image', label: 'Image profile', onSelect: () => onAdd('image'), disabled: !offers.image },
    { key: 'embedding', label: 'Embedding profile', onSelect: () => onAdd('embedding'), disabled: !offers.embedding },
  ]

  return (
    <section ref={sectionRef} className="qt-settings-provider-card" id={domId} aria-labelledby={headingId} data-provider={group.provider}>
      <button
        type="button"
        className="qt-settings-provider-card-header"
        aria-expanded={isOpen}
        aria-controls={bodyId}
        onClick={() => setIsOpen((v) => !v)}
      >
        <span className="min-w-0">
          <span id={headingId} className="qt-settings-provider-card-title block">{displayName}</span>
          <span className="qt-settings-provider-card-summary block">{summary}</span>
        </span>
        <Icon
          name="chevron-down"
          className={`w-5 h-5 qt-settings-provider-card-chevron ${isOpen ? 'qt-settings-provider-card-chevron-open' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="qt-settings-provider-card-body" id={bodyId}>
          <div className="flex items-center justify-end">
            <ItemActionMenu
              entries={entries}
              label={`Add to ${displayName}`}
              trigger={{ content: '+ Add', ariaLabel: `Add to ${displayName}`, className: 'qt-button-secondary qt-button-sm' }}
            />
          </div>

          {group.keys.length > 0 && (
            <div>
              <h4 className="qt-text-label mb-2">Keys</h4>
              <div className="qt-card-grid-auto">
                {group.keys.map((key) => (
                  <ApiKeyCard
                    key={key.id}
                    apiKey={key}
                    actions={keyActions}
                    headerExtra={<PersonaBadge persona="saquel" />}
                  />
                ))}
              </div>
            </div>
          )}

          <div>
            <h4 className="qt-text-label mb-2">Profiles</h4>
            {group.profiles.length === 0 ? (
              <p className="qt-text-small qt-text-muted">No profiles use {displayName} yet.</p>
            ) : (
              <ul className="qt-settings-provider-profile-list">
                {group.profiles.map((entry) => (
                  <li key={`${entry.kind}-${entry.profile.id}`}>
                    <button
                      type="button"
                      className="qt-settings-provider-profile-row"
                      data-kind={entry.kind}
                      onClick={() => onOpenProfile(entry)}
                    >
                      <span className="qt-settings-provider-kind-badge">
                        {PROVIDER_PROFILE_KIND_LABELS[entry.kind]}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{entry.profile.name}</span>
                        {entry.profile.modelName && (
                          <span className="qt-settings-provider-profile-model block">{entry.profile.modelName}</span>
                        )}
                      </span>
                      <PersonaBadge persona={KIND_PERSONA[entry.kind]} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

// --- Add a provider -------------------------------------------------------------

function AddProviderCard({ hasProviders, onAddKey }: { hasProviders: boolean; onAddKey: () => void }) {
  return (
    <section className="qt-settings-provider-card qt-settings-provider-card-add p-4" aria-labelledby="provider-add-heading">
      <h4 id="provider-add-heading" className="qt-settings-provider-card-title">Add a provider</h4>
      <p className="qt-text-small qt-text-muted mt-1 mb-3">
        {hasProviders
          ? 'Bring another provider aboard with its key, or let the Setup Wizard walk you through it.'
          : 'No providers yet. Add a key, or let the Setup Wizard walk you through it.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="qt-button-primary qt-button-sm" onClick={onAddKey}>
          Add an API key
        </button>
        <Link href="/settings/wizard" className="qt-button-secondary qt-button-sm">
          Open the Setup Wizard
        </Link>
      </div>
    </section>
  )
}
