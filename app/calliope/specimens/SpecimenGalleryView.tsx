'use client'

/**
 * Calliope's specimen gallery — the theme-specimens workspace tab.
 *
 * The chrome (title, search, the mode switch and the list of surfaces)
 * wears the house default, like the editor's panel, so a draft cannot make
 * it unreadable. The specimens wear whatever theme the window shows: the
 * draft being edited when the Atelier is previewing one, the theme worn
 * otherwise. The gallery only reads the preview; it never sets one.
 *
 * @module app/calliope/specimens/SpecimenGalleryView
 */

import { useCallback, useDeferredValue, useEffect, useId, useState } from 'react'
import { useTheme } from '@/components/providers/theme-provider'
import { SpecimenGallery, specimenHeadingId, surfaceDomId, type GalleryMode, type StageTheme } from '@/components/theme-specimens/SpecimenGallery'
import { useInspectOptional } from '@/components/theme-inspect/InspectProvider'
import { InspectToggle } from '@/components/theme-inspect/InspectToggle'
import { hookGroups } from '@/components/theme-editor/assets/styles-model'
import { THEME_CHOICES } from '@/lib/themes/engine/client'

type ModeChoice = 'window' | 'light' | 'dark' | 'both'

const MODE_CHOICES: ReadonlyArray<[ModeChoice, string]> = [
  ['window', 'As the window'],
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['both', 'Side by side'],
]

/** The root's choice attributes (`data-qt-density`, …), kept current as the shown theme changes. */
function useRootChoiceAttributes(): Record<string, string> {
  const [attributes, setAttributes] = useState<Record<string, string>>({})
  useEffect(() => {
    const root = document.documentElement
    const read = () => {
      const next: Record<string, string> = {}
      for (const choice of THEME_CHOICES) {
        const name = `data-qt-${choice.name}`
        const value = root.getAttribute(name)
        if (value !== null) next[name] = value
      }
      setAttributes((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(root, { attributes: true, attributeFilter: THEME_CHOICES.map((c) => `data-qt-${c.name}`) })
    return () => observer.disconnect()
  }, [])
  return attributes
}

/** Frames a reveal waits for the specimen to be drawn (a cleared search re-renders the gallery). */
const REVEAL_FRAMES = 30

export function SpecimenGalleryView() {
  const { preview, activeThemeId, availableThemes, resolvedColorMode } = useTheme()
  const baseId = useId()
  const [query, setQuery] = useState('')
  const [modeChoice, setModeChoice] = useState<ModeChoice>('window')
  const deferredQuery = useDeferredValue(query)
  const choiceAttributes = useRootChoiceAttributes()

  const windowMode: GalleryMode = resolvedColorMode === 'dark' ? 'dark' : 'light'
  const modes: GalleryMode[] = modeChoice === 'both' ? ['light', 'dark'] : [modeChoice === 'window' ? windowMode : modeChoice]
  const themeId = preview?.themeId ?? activeThemeId ?? 'default'
  const stage: StageTheme = { themeId, choiceAttributes }
  const themeName = availableThemes.find((t) => t.id === themeId)?.name ?? themeId
  const groups = hookGroups(deferredQuery)
  const total = groups.reduce((n, g) => n + g.hooks.length, 0)

  // The inspector's "Show in the gallery": clear the search, then bring the hook's specimen to view.
  const inspect = useInspectOptional()
  const registerGallery = inspect?.registerGallery
  const reveal = useCallback((className: string) => {
    setQuery('')
    let frames = 0
    const seek = () => {
      const heading = document.getElementById(specimenHeadingId(className))
      if (heading) {
        heading.scrollIntoView({ block: 'start' })
        heading.focus({ preventScroll: true })
        // Specimens above it are drawn as they come near (content-visibility), so the first scroll can land short:
        // scroll again until it stays put.
        let last = Number.NaN
        let settles = 0
        const settle = () => {
          const top = heading.getBoundingClientRect().top
          if (top === last || ++settles > REVEAL_FRAMES) return
          last = top
          heading.scrollIntoView({ block: 'start' })
          requestAnimationFrame(settle)
        }
        requestAnimationFrame(settle)
        return
      }
      if (++frames < REVEAL_FRAMES) requestAnimationFrame(seek)
    }
    requestAnimationFrame(seek)
  }, [])
  useEffect(() => registerGallery?.({ reveal }), [registerGallery, reveal])

  const goTo = (surface: string) => {
    const el = document.getElementById(surfaceDomId(baseId, surface))
    el?.scrollIntoView({ block: 'start' })
    el?.querySelector('h2')?.focus()
  }

  return (
    <div data-theme="default" className={`${windowMode} h-full overflow-y-auto qt-bg-default qt-text`} data-testid="theme-specimens-panel" data-inspect-ignore="">
      <div className="max-w-6xl mx-auto p-4 space-y-4 @container">
        <header className="space-y-1">
          <h1 className="qt-heading-2">Calliope&rsquo;s Specimens</h1>
          <p className="qt-text-small qt-text-secondary">
            Every hook a theme may dress, drawn in each of its variants and states and wearing{' '}
            {preview ? <>the draft <strong>{themeName}</strong>, as the Atelier previews it</> : <><strong>{themeName}</strong>, the theme you wear</>}.
            Hover and focus are not forced: point at a specimen, or Tab to it, to see them.
          </p>
        </header>

        <div className="qt-card p-3 flex items-center gap-3 flex-wrap sticky top-0 z-10" role="toolbar" aria-label="Finding and showing specimens">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <label htmlFor={`${baseId}-search`} className="sr-only">Search the specimens</label>
            <input
              id={`${baseId}-search`}
              type="search"
              className="qt-input qt-text-small min-w-0 flex-1"
              placeholder="Search by label or class name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div role="radiogroup" aria-label="Mode the specimens are drawn in" className="flex">
            {MODE_CHOICES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={modeChoice === value}
                className={`qt-button qt-button-sm ${modeChoice === value ? 'qt-button-primary' : 'qt-button-secondary'}`}
                onClick={() => setModeChoice(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <InspectToggle />
        </div>
        <p className="sr-only" aria-live="polite">{query.trim() ? `${total} hooks answer.` : ''}</p>

        <div className="grid gap-4 @3xl:grid-cols-[13rem_minmax(0,1fr)] items-start">
          <nav aria-label="Surfaces" className="qt-card p-2 @3xl:sticky @3xl:top-20 @3xl:max-h-[calc(100vh-8rem)] @3xl:overflow-y-auto">
            {groups.length === 0 ? (
              <p className="qt-text-xs qt-text-muted p-2">No surface answers.</p>
            ) : (
              <ul className="space-y-0.5">
                {groups.map((g) => (
                  <li key={g.surface}>
                    <button type="button" className="qt-button qt-button-ghost qt-button-sm w-full justify-between text-left" onClick={() => goTo(g.surface)}>
                      <span className="truncate">{g.title}</span>
                      <span className="qt-badge-secondary ml-2" aria-label={`${g.hooks.length} hooks`}>{g.hooks.length}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>
          <div className="min-w-0">
            <SpecimenGallery query={deferredQuery} modes={modes} stage={stage} idPrefix={baseId} />
          </div>
        </div>
      </div>
    </div>
  )
}
