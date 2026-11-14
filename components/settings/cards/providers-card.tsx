'use client'

/**
 * The Providers card (Connections group).
 *
 * Two views over the same lists:
 * - **By provider** (default): one collapsible card per configured provider,
 *   with its keys and every profile that uses it (`ProvidersByProvider`).
 * - **By kind**: the four kind cards as they always were — API Keys,
 *   Connection Profiles, Image Profiles, Embedding Profiles.
 *
 * The four kind cards are registered as hosted by this card
 * (`hostedBy: 'providers'`), so a deep link to one of them (`?section=
 * image-profiles`) arrives as `focusCard` and switches to *By kind* with that
 * card open. The view choice is a per-browser convenience in localStorage.
 *
 * @module components/settings/cards/providers-card
 */

import { useCallback, useState, useSyncExternalStore } from 'react'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { hostedCardsOf } from '@/lib/settings/registry'
import { PersonaBadge } from '@/components/settings/PersonaBadge'
import type { ComponentType } from 'react'
import { ApiKeysCard, ConnectionProfilesCard, ImageProfilesCard, EmbeddingProfilesCard } from './connections-cards'
import { ProvidersByProvider } from './providers-by-provider'

/** The kind cards this card hosts, keyed by their registry id. */
const HOSTED_CARD_COMPONENTS: Record<string, ComponentType> = {
  'api-keys': ApiKeysCard,
  'connection-profiles': ConnectionProfilesCard,
  'image-profiles': ImageProfilesCard,
  'embedding-profiles': EmbeddingProfilesCard,
}

export type ProvidersView = 'provider' | 'kind'

export const PROVIDERS_VIEW_STORAGE_KEY = 'quilltap.settings.providersView'

const listeners = new Set<() => void>()

function readStoredView(): ProvidersView {
  try {
    return window.localStorage.getItem(PROVIDERS_VIEW_STORAGE_KEY) === 'kind' ? 'kind' : 'provider'
  } catch {
    return 'provider'
  }
}

function writeStoredView(view: ProvidersView) {
  try {
    window.localStorage.setItem(PROVIDERS_VIEW_STORAGE_KEY, view)
  } catch {
    // Storage unavailable (private window, blocked site data): the toggle still works for this visit.
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function useStoredView(): [ProvidersView, (v: ProvidersView) => void] {
  const view = useSyncExternalStore(subscribe, readStoredView, () => 'provider' as const)
  return [view, writeStoredView]
}

export interface ProvidersCardProps {
  /** A hosted card to open (a deep link or search target); forces the *By kind* view. */
  focusCard?: string | null
  /** A provider whose card to open (the missing-key attention chip); forces the *By provider* view. */
  focusProvider?: string | null
  /** Search terms to mark in the hosted cards' titles. */
  highlight?: string[]
}

export function ProvidersCard({ focusCard, focusProvider, highlight }: ProvidersCardProps) {
  const [storedView, setStoredView] = useStoredView()
  const hosted = hostedCardsOf('providers')
  const focusIsHosted = !!focusCard && hosted.some((c) => c.id === focusCard)
  // A deep link to a kind card wins until the user picks a view themselves.
  const [overridden, setOverridden] = useState(false)
  const forced: ProvidersView | null = focusIsHosted ? 'kind' : focusProvider ? 'provider' : null
  const view: ProvidersView = forced && !overridden ? forced : storedView

  const choose = useCallback(
    (next: ProvidersView) => {
      setOverridden(true)
      setStoredView(next)
    },
    [setStoredView],
  )

  return (
    <div className="space-y-4">
      <div className="qt-tab-group inline-flex" role="group" aria-label="Arrange providers">
        <button
          type="button"
          className={`qt-tab ${view === 'provider' ? 'qt-tab-active' : ''}`}
          aria-pressed={view === 'provider'}
          onClick={() => choose('provider')}
        >
          By provider
        </button>
        <button
          type="button"
          className={`qt-tab ${view === 'kind' ? 'qt-tab-active' : ''}`}
          aria-pressed={view === 'kind'}
          onClick={() => choose('kind')}
        >
          By kind
        </button>
      </div>

      {view === 'provider' ? (
        <ProvidersByProvider focusProvider={focusProvider} />
      ) : (
        <div className="space-y-4">
          {hosted.map((card) => {
            const Body = HOSTED_CARD_COMPONENTS[card.id]
            return (
              <CollapsibleCard
                key={card.id}
                title={card.title}
                description={card.description}
                sectionId={card.id}
                badge={<PersonaBadge persona={card.persona} />}
                highlight={highlight}
                forceOpen={focusCard === card.id}
              >
                {Body ? <Body /> : null}
              </CollapsibleCard>
            )
          })}
        </div>
      )}
    </div>
  )
}
