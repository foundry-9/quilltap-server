'use client'

/**
 * Calliope's Atelier — the reference beside the custom CSS (Calliope Live,
 * Spec G decision 3): the hook catalogue, the tokens and primitives, and the
 * draft's images, each searchable, each entry inserting its selector,
 * `var(--name)` or `url()` at the caret. It stands in for completion.
 *
 * @module components/theme-editor/assets/StylesReference
 */

import { useId, useMemo, useState } from 'react'
import type { HookDef } from '@/lib/themes/hooks'
import type { ResolvedTheme, ThemeTokensDocument } from '@/lib/themes/engine/client'
import type { DraftDetail } from '../use-theme-drafts'
import { useInspectOptional } from '@/components/theme-inspect/InspectProvider'
import type { EditorMode } from '../model'
import { filterTokenEntries, hookGroups, hookSelectors, imageEntries, tokenEntries } from './styles-model'

type Tab = 'hooks' | 'tokens' | 'images'

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'hooks', label: 'Hooks' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'images', label: 'Images' },
]

/** How many token rows are drawn at once; a search narrows the rest. */
export const TOKEN_ROW_LIMIT = 60

interface StylesReferenceProps {
  tokens: ThemeTokensDocument
  resolved: ResolvedTheme
  mode: EditorMode
  images: DraftDetail['images']
  onInsert: (text: string) => void
}

function HookEntry({ hook, onInsert }: { hook: HookDef; onInsert: (text: string) => void }) {
  const selectors = useMemo(() => hookSelectors(hook), [hook])
  const [chosen, setChosen] = useState(selectors[0].selector)
  const selectId = useId()
  const inspect = useInspectOptional()
  const [notFound, setNotFound] = useState(false)
  const inspectOnPage = () => setNotFound(!inspect?.inspectHook(hook.className))
  return (
    <li className="py-2 border-b qt-border-default last:border-b-0">
      <p className="qt-text-small font-medium">{hook.label}</p>
      <p className="qt-text-xs font-mono qt-text-secondary break-all">.{hook.className}</p>
      {hook.description && <p className="qt-text-xs qt-text-secondary mt-1">{hook.description}</p>}
      <div className="flex items-center gap-2 mt-1 flex-wrap">
        {selectors.length > 1 && (
          <>
            <label htmlFor={selectId} className="sr-only">
              Which {hook.label.toLowerCase()} to select
            </label>
            <select id={selectId} className="qt-select qt-select-sm min-w-0 flex-1" value={chosen} onChange={(e) => setChosen(e.target.value)}>
              {selectors.map((s) => (
                <option key={s.selector} value={s.selector}>
                  {s.label}
                </option>
              ))}
            </select>
          </>
        )}
        <button
          type="button"
          className="qt-button qt-button-secondary qt-button-sm"
          aria-label={`Insert ${chosen}`}
          onClick={() => onInsert(chosen)}
        >
          Insert
        </button>
        {inspect && (
          <button type="button" className="qt-button qt-button-ghost qt-button-sm" aria-label={`Inspect ${hook.label.toLowerCase()} on the page`} onClick={inspectOnPage}>
            Inspect this
          </button>
        )}
      </div>
      {inspect && notFound && (
        <p className="qt-text-xs qt-text-secondary mt-1" role="status">
          Nothing on the page wears it just now.{' '}
          <button type="button" className="underline" onClick={() => inspect.showInGallery(hook.className)}>
            Show it in the gallery
          </button>
        </p>
      )}
    </li>
  )
}

export function StylesReference({ tokens, resolved, mode, images, onInsert }: StylesReferenceProps) {
  const [tab, setTab] = useState<Tab>('hooks')
  const [query, setQuery] = useState('')
  const baseId = useId()
  const searchId = `${baseId}-search`

  const groups = useMemo(() => (tab === 'hooks' ? hookGroups(query) : []), [tab, query])
  const allTokens = useMemo(() => tokenEntries(tokens, resolved, mode), [tokens, resolved, mode])
  const tokenRows = useMemo(() => (tab === 'tokens' ? filterTokenEntries(allTokens, query) : []), [tab, allTokens, query])
  const imageRows = useMemo(() => (tab === 'images' ? imageEntries(images, query) : []), [tab, images, query])

  const searchLabel = tab === 'hooks' ? 'Search the hooks' : tab === 'tokens' ? 'Search the tokens and primitives' : 'Search the images'

  return (
    <section className="qt-card p-3 space-y-2 min-w-0" aria-labelledby={`${baseId}-heading`}>
      <h4 id={`${baseId}-heading`} className="qt-heading-4">Reference</h4>
      <p className="qt-text-xs qt-text-secondary">Choose an entry to set it down at the caret.</p>
      <div role="group" aria-label="What to look up" className="flex">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tab === t.id}
            className={`qt-button qt-button-sm ${tab === t.id ? 'qt-button-primary' : 'qt-button-secondary'}`}
            onClick={() => {
              // Each list has its own vocabulary; a hook search means nothing among the images.
              if (t.id !== tab) setQuery('')
              setTab(t.id)
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <label htmlFor={searchId} className="sr-only">
        {searchLabel}
      </label>
      <input
        id={searchId}
        type="search"
        className="qt-input qt-text-small w-full"
        placeholder={tab === 'hooks' ? 'Label, class or state' : tab === 'tokens' ? 'Name, label or value' : 'File name'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="max-h-[32rem] overflow-y-auto">
        {tab === 'hooks' &&
          (groups.length === 0 ? (
            <p className="qt-text-xs qt-text-muted">No hook answers to that.</p>
          ) : (
            groups.map((g) => (
              <div key={g.surface} className="mb-2">
                <h5 className="qt-text-xs font-semibold qt-text-secondary uppercase tracking-wide mt-2">{g.title}</h5>
                <ul aria-label={`${g.title} hooks`}>
                  {g.hooks.map((hook) => (
                    <HookEntry key={hook.className} hook={hook} onInsert={onInsert} />
                  ))}
                </ul>
              </div>
            ))
          ))}

        {tab === 'tokens' &&
          (tokenRows.length === 0 ? (
            <p className="qt-text-xs qt-text-muted">No token or primitive answers to that.</p>
          ) : (
            <>
              <ul aria-label="Tokens and primitives">
                {tokenRows.slice(0, TOKEN_ROW_LIMIT).map((entry) => (
                  <li key={entry.name} className="py-2 border-b qt-border-default last:border-b-0 flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="qt-text-small font-medium">{entry.label}</p>
                      <p className="qt-text-xs font-mono qt-text-secondary break-all">{entry.name}</p>
                      <p className="qt-text-xs qt-text-muted break-all">
                        {entry.value ? `In ${mode}: ${entry.value}` : `Unset in ${mode}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="qt-button qt-button-secondary qt-button-sm shrink-0"
                      aria-label={`Insert ${entry.insert}`}
                      onClick={() => onInsert(entry.insert)}
                    >
                      Insert
                    </button>
                  </li>
                ))}
              </ul>
              {tokenRows.length > TOKEN_ROW_LIMIT && (
                <p className="qt-text-xs qt-text-muted mt-2">
                  {tokenRows.length - TOKEN_ROW_LIMIT} more; narrow the search to see them.
                </p>
              )}
            </>
          ))}

        {tab === 'images' &&
          (imageRows.length === 0 ? (
            <p className="qt-text-xs qt-text-muted">
              {images.length === 0 ? 'This draft carries no images yet; add them in the Images section.' : 'No image answers to that.'}
            </p>
          ) : (
            <ul aria-label="Images">
              {imageRows.map((entry) => (
                <li key={entry.path} className="py-2 border-b qt-border-default last:border-b-0 flex items-center gap-2">
                  {entry.url ? (
                    <img src={entry.url} alt="" className="w-10 h-10 object-cover rounded shrink-0" />
                  ) : (
                    <span className="w-10 h-10 shrink-0" aria-hidden="true" />
                  )}
                  <p className="qt-text-xs font-mono min-w-0 flex-1 break-all">{entry.path}</p>
                  <button
                    type="button"
                    className="qt-button qt-button-secondary qt-button-sm shrink-0"
                    aria-label={`Insert ${entry.insert}`}
                    onClick={() => onInsert(entry.insert)}
                  >
                    Insert
                  </button>
                </li>
              ))}
            </ul>
          ))}
      </div>
    </section>
  )
}
