'use client'

/**
 * The Foundry — the instance-wide Settings page.
 *
 * Renders entirely from the settings registry (`lib/settings/registry.ts`): a
 * rail of groups (a `<select>` below `md`), the selected group's cards as
 * `CollapsibleCard`s with an "Advanced" divider, a search field that narrows
 * the page as you type, a persona row whose chips are lenses over the whole
 * page, and the attention strip. Every card wears its persona's badge.
 *
 * Addressing: `?group=`, `?section=` (a card), `?persona=`, `?q=`, and the
 * legacy `?tab=` / `?tab=&section=` — all resolved by `resolveSettingsLink`.
 * A workspace tab passes the same values as props instead of the URL.
 *
 * Design of record: docs/developer/features/complete/settings-redesign.md
 */

import { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { BrandName } from '@/components/ui/brand-name'
import { ChatSettingsProvider } from '@/components/settings/chat-settings/ChatSettingsProvider'
import { AttentionStrip, useAttentionChips, type AttentionChip } from '@/components/settings/AttentionStrip'
import { PersonaBadge } from '@/components/settings/PersonaBadge'
import { SETTINGS_CARD_COMPONENTS } from '@/components/settings/cards'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { Icon } from '@/components/ui/icon'
import {
  useAllSubsystemInfo,
  useSubsystemBackgroundStyle,
  useSubsystemInfo,
} from '@/components/providers/theme-provider'
import {
  DEFAULT_SETTINGS_GROUP,
  SETTINGS_CARDS,
  SETTINGS_GROUPS,
  getSettingsCard,
  getSettingsGroup,
  isSettingsPersona,
  resolveSettingsLink,
  searchSettingsCards,
  searchTerms,
  type SettingsCard,
  type SettingsGroupId,
  type SettingsPersona,
} from '@/lib/settings/registry'
import { DEFAULT_SUBSYSTEM_DEFINITIONS, type SubsystemId } from '@/lib/foundry/subsystem-defaults'

export interface SettingsViewProps {
  /** Group to open (`?group=`). */
  group?: string
  /** Legacy tab id (`?tab=`), bridged to a group. */
  tab?: string
  /** Card to open and scroll to (`?section=`). */
  section?: string
  /** Persona lens (`?persona=`). */
  persona?: string
  /** Search to pre-fill (`?q=`). */
  q?: string
  /** Provider card to open inside Connections → Providers (`&provider=`). */
  provider?: string
}

interface AddressParams {
  group: string | null
  tab: string | null
  section: string | null
  persona: string | null
  q: string | null
  provider: string | null
}

function paramsKey(p: AddressParams): string {
  return [p.group, p.tab, p.section, p.persona, p.q, p.provider].map((v) => v ?? '').join('|')
}

function isEditable(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable
  )
}

/** Cards that pass the active filters, flattened: a hosted card stands alone unless its host also passes. */
function visibleCardsFor(filtered: SettingsCard[] | null): SettingsCard[] | null {
  if (!filtered) return null
  const ids = new Set(filtered.map((c) => c.id))
  return filtered.filter((c) => !c.hostedBy || !ids.has(c.hostedBy))
}

function SettingsPage({ address, inWorkspace }: { address: AddressParams; inWorkspace: boolean }) {
  const router = useRouter()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const selectId = useId()
  const liveId = useId()

  const link = useMemo(
    () => resolveSettingsLink({ get: (k: string) => address[k as keyof AddressParams] ?? null }),
    [address],
  )
  const addressLens = isSettingsPersona(address.persona) ? address.persona : null

  // --- State, reset whenever a new address arrives from outside ------------
  const [seenKey, setSeenKey] = useState(() => paramsKey(address))
  const [chosenGroup, setChosenGroup] = useState<SettingsGroupId | null>(link?.group ?? null)
  const [focusCard, setFocusCard] = useState<string | null>(link?.card ?? null)
  const [focusProvider, setFocusProvider] = useState<string | null>(address.provider)
  const [lens, setLens] = useState<SettingsPersona | null>(addressLens)
  const [query, setQuery] = useState(address.q ?? '')
  const [searchGroup, setSearchGroup] = useState<SettingsGroupId | null>(null)
  const [openCards, setOpenCards] = useState<Set<string>>(() => initialOpenCards(link?.card ?? null))
  const [closedInSearch, setClosedInSearch] = useState<Set<string>>(() => new Set())
  // The address this page last wrote to the URL; its echo is not a new deep link.
  const [writtenKey, setWrittenKey] = useState<string | null>(null)

  const incomingKey = paramsKey(address)
  if (incomingKey !== seenKey) {
    setSeenKey(incomingKey)
    if (incomingKey !== writtenKey) {
      setChosenGroup(link?.group ?? null)
      setFocusCard(link?.card ?? null)
      setFocusProvider(address.provider)
      setLens(addressLens)
      setQuery(address.q ?? '')
      setSearchGroup(null)
      setOpenCards((prev) => withFocus(prev, link?.card ?? null))
    }
  }

  // --- Attention strip + default group --------------------------------------
  const { chips } = useAttentionChips()
  const defaultGroup: SettingsGroupId = chips[0]?.group ?? DEFAULT_SETTINGS_GROUP

  // --- Filters ---------------------------------------------------------------
  const subsystems = useAllSubsystemInfo()
  const personaName = useCallback(
    (p: SettingsPersona) =>
      subsystems.find((s) => s.id === p)?.name ?? DEFAULT_SUBSYSTEM_DEFINITIONS[p].name,
    [subsystems],
  )
  const terms = useMemo(() => searchTerms(query), [query])
  const searching = terms.length > 0

  const filtered = useMemo<SettingsCard[] | null>(() => {
    if (!searching && !lens) return null
    let cards: SettingsCard[] = searching ? searchSettingsCards(query, personaName) : [...SETTINGS_CARDS]
    if (lens) cards = cards.filter((c) => c.persona === lens)
    return cards
  }, [searching, lens, query, personaName])
  const visible = useMemo(() => visibleCardsFor(filtered), [filtered])

  const countsByGroup = useMemo(() => {
    const counts = new Map<SettingsGroupId, number>()
    for (const c of visible ?? []) counts.set(c.group, (counts.get(c.group) ?? 0) + 1)
    return counts
  }, [visible])

  const railGroups = visible ? SETTINGS_GROUPS.filter((g) => countsByGroup.has(g.id)) : SETTINGS_GROUPS

  const baseGroup: SettingsGroupId = chosenGroup ?? defaultGroup
  let activeGroup: SettingsGroupId = baseGroup
  if (visible) {
    const preferred = searching ? (searchGroup ?? baseGroup) : baseGroup
    activeGroup = countsByGroup.has(preferred) ? preferred : (railGroups[0]?.id ?? baseGroup)
  }
  const group = getSettingsGroup(activeGroup)!

  // --- Addressing (standalone page only; a workspace tab's URL is /workspace) --
  const writeAddress = useCallback(
    (next: { group?: SettingsGroupId | null; persona?: SettingsPersona | null }) => {
      if (inWorkspace) return
      const params = new URLSearchParams()
      if (next.group) params.set('group', next.group)
      if (next.persona) params.set('persona', next.persona)
      const written: AddressParams = {
        group: next.group ?? null,
        tab: null,
        section: null,
        persona: next.persona ?? null,
        q: null,
        provider: null,
      }
      setWrittenKey(paramsKey(written))
      const qs = params.toString()
      router.replace(qs ? `/settings?${qs}` : '/settings', { scroll: false })
    },
    [inWorkspace, router],
  )

  const selectGroup = useCallback(
    (id: SettingsGroupId) => {
      setFocusCard(null)
      if (searching) {
        setSearchGroup(id)
        return
      }
      setChosenGroup(id)
      writeAddress({ group: id, persona: lens })
    },
    [searching, lens, writeAddress],
  )

  const chooseLens = useCallback(
    (persona: SettingsPersona | null) => {
      setLens(persona)
      setFocusCard(null)
      writeAddress({ group: chosenGroup, persona })
    },
    [chosenGroup, writeAddress],
  )

  const openChip = useCallback(
    (chip: AttentionChip) => {
      setQuery('')
      setLens(null)
      setChosenGroup(chip.group)
      setFocusCard(chip.card)
      setFocusProvider(chip.provider ?? null)
      setOpenCards((prev) => withFocus(prev, chip.card))
      writeAddress({ group: chip.group })
    },
    [writeAddress],
  )

  // --- `/` focuses the search; Escape in it clears ---------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      if (isEditable(document.activeElement)) return
      // A kept-alive workspace tab stays mounted while hidden; only the visible page answers.
      const root = rootRef.current
      if (!root || (typeof root.checkVisibility === 'function' && !root.checkVisibility())) return
      e.preventDefault()
      searchInputRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // --- Open state: page-level, so it survives group switches and a search ---
  const isCardOpen = (id: string) => (searching ? !closedInSearch.has(id) : openCards.has(id))
  const setCardOpen = (id: string, open: boolean) => {
    if (searching) {
      setClosedInSearch((prev) => toggled(prev, id, !open))
    } else {
      setOpenCards((prev) => toggled(prev, id, open))
    }
  }

  // --- Backdrop ---------------------------------------------------------------
  const backdropPersona: SubsystemId = lens ?? group.persona
  const containerStyle = useSubsystemBackgroundStyle(backdropPersona)

  // --- Column ----------------------------------------------------------------
  const groupCards = visible
    ? visible.filter((c) => c.group === activeGroup)
    : SETTINGS_CARDS.filter((c) => c.group === activeGroup && !c.hostedBy)
  const mainCards = groupCards.filter((c) => !c.advanced)
  const advancedCards = groupCards.filter((c) => c.advanced)
  const matchCount = visible?.length ?? 0

  const renderCard = (card: SettingsCard) => {
    const Body = SETTINGS_CARD_COMPONENTS[card.id]
    const hostsFocus = !!focusCard && getSettingsCard(focusCard)?.hostedBy === card.id
    const forced = focusCard === card.id || hostsFocus
    return (
      <CollapsibleCard
        key={card.id}
        title={card.title}
        description={card.description}
        sectionId={card.id}
        badge={<PersonaBadge persona={card.persona} />}
        highlight={terms}
        forceOpen={forced}
        isOpen={isCardOpen(card.id)}
        onOpenChange={(open) => setCardOpen(card.id, open)}
      >
        {Body ? <Body
            focusCard={hostsFocus ? focusCard : null}
            focusProvider={focusCard === card.id ? focusProvider : null}
            highlight={terms}
          /> : null}
      </CollapsibleCard>
    )
  }

  return (
    <div className="qt-page-container" style={containerStyle} ref={rootRef}>
      <div className="qt-settings-header mb-6">
        <h1 className="qt-heading-1">The Foundry</h1>
        <p className="qt-text-muted mt-2">
          Settings — configure and manage every aspect of your <BrandName /> workspace
        </p>
      </div>

      <div className="space-y-4 mb-6">
        <AttentionStrip chips={chips} onSelect={openChip} />

        <div className="qt-settings-persona-row" role="group" aria-label="Show one member of staff's settings">
          {subsystems.map((info) => (
            <button
              key={info.id}
              type="button"
              className="qt-settings-persona-chip"
              aria-pressed={lens === info.id}
              title={info.description}
              onClick={() => chooseLens(lens === info.id ? null : (info.id as SettingsPersona))}
            >
              {info.thumbnail ? <img src={info.thumbnail} alt="" /> : null}
              <span>{info.name}</span>
            </button>
          ))}
        </div>

        <div className="qt-settings-search">
          <Icon name="search" />
          <input
            ref={searchInputRef}
            type="search"
            className="qt-input"
            aria-label="Search settings"
            aria-describedby={liveId}
            placeholder="Search settings (press / to search)"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSearchGroup(null)
              setClosedInSearch(new Set())
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.preventDefault()
                setQuery('')
              }
            }}
          />
        </div>
        <p id={liveId} className="sr-only" aria-live="polite">
          {searching ? `${matchCount} ${matchCount === 1 ? 'setting matches' : 'settings match'}` : ''}
        </p>

        {lens && <LensBanner persona={lens} onClear={() => chooseLens(null)} />}
      </div>

      <div className="qt-settings-layout">
        <div>
          <label htmlFor={selectId} className="qt-label md:sr-only">
            Section
          </label>
          <select
            id={selectId}
            className="qt-select qt-settings-rail-select"
            value={activeGroup}
            onChange={(e) => selectGroup(e.target.value as SettingsGroupId)}
          >
            {railGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
                {visible ? ` (${countsByGroup.get(g.id) ?? 0})` : ''}
              </option>
            ))}
          </select>
          <nav className="qt-settings-rail" aria-label="Settings sections">
            {railGroups.map((g) => (
              <button
                key={g.id}
                type="button"
                className="qt-settings-rail-item"
                aria-current={g.id === activeGroup ? 'page' : undefined}
                onClick={() => selectGroup(g.id)}
              >
                <Icon name={g.icon} className="w-4 h-4 flex-shrink-0" />
                <span>{g.title}</span>
                {visible && <span className="qt-settings-rail-count">{countsByGroup.get(g.id) ?? 0}</span>}
              </button>
            ))}
          </nav>
        </div>

        <section className="qt-settings-panel min-w-0" aria-labelledby={`settings-group-${group.id}`}>
          <h2 id={`settings-group-${group.id}`} className="qt-heading-2">
            {group.title}
          </h2>
          <p className="qt-text-small qt-text-muted italic mt-1 mb-6">{group.description}</p>

          {visible && groupCards.length === 0 ? (
            <p className="qt-text-muted">
              Nothing here answers to that description. Try another word — “password”, “dice”, “censor”.
            </p>
          ) : (
            <>
              <div className="space-y-4">{mainCards.map(renderCard)}</div>
              {advancedCards.length > 0 && (
                <>
                  <div className="qt-settings-advanced-divider" role="separator">
                    Advanced
                  </div>
                  <div className="space-y-4">{advancedCards.map(renderCard)}</div>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function LensBanner({ persona, onClear }: { persona: SettingsPersona; onClear: () => void }) {
  const info = useSubsystemInfo(persona)
  return (
    <div className="qt-settings-lens-banner">
      <PersonaBadge persona={persona} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Showing only {info.name}&apos;s settings</p>
        <p className="qt-text-small qt-text-muted">{info.description}</p>
      </div>
      <button type="button" className="qt-button-secondary qt-button-sm" onClick={onClear}>
        Show everything
      </button>
    </div>
  )
}

function toggled(set: Set<string>, id: string, include: boolean): Set<string> {
  if (set.has(id) === include) return set
  const next = new Set(set)
  if (include) next.add(id)
  else next.delete(id)
  return next
}

function initialOpenCards(focus: string | null): Set<string> {
  const open = new Set(SETTINGS_CARDS.filter((c) => c.defaultOpen).map((c) => c.id))
  return withFocus(open, focus)
}

/** Open the focused card, or its host when it lives inside another card. */
function withFocus(set: Set<string>, focus: string | null): Set<string> {
  if (!focus) return set
  const card = getSettingsCard(focus)
  if (!card) return set
  return toggled(set, card.hostedBy ?? card.id, true)
}

function SettingsFromAddress(props: SettingsViewProps) {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const inWorkspace = pathname !== '/settings'
  const fromProps = !!(props.group || props.tab || props.section || props.persona || props.q || props.provider)
  const address: AddressParams = useMemo(
    () =>
      fromProps || inWorkspace
        ? {
            group: props.group ?? null,
            tab: props.tab ?? null,
            section: props.section ?? null,
            persona: props.persona ?? null,
            q: props.q ?? null,
            provider: props.provider ?? null,
          }
        : {
            group: searchParams.get('group'),
            tab: searchParams.get('tab'),
            section: searchParams.get('section'),
            persona: searchParams.get('persona'),
            q: searchParams.get('q'),
            provider: searchParams.get('provider'),
          },
    [fromProps, inWorkspace, props.group, props.tab, props.section, props.persona, props.q, props.provider, searchParams],
  )
  return <SettingsPage address={address} inWorkspace={inWorkspace} />
}

export function SettingsView(props: SettingsViewProps = {}) {
  return (
    <ChatSettingsProvider>
      <Suspense fallback={<div className="qt-text-secondary">Loading...</div>}>
        <SettingsFromAddress {...props} />
      </Suspense>
    </ChatSettingsProvider>
  )
}
