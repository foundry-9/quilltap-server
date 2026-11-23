'use client'

/**
 * Calliope's Atelier — the Icons section (Spec F, Stage 1).
 *
 * Every icon in Quilltap as this theme draws it, in registry order, with a
 * search by name; the ones the theme redraws are marked. Choosing one offers
 * to upload a replacement (SVG, tinted by the text colour as the app tints
 * it, or WebP, drawn as it is) or to remove the override.
 *
 * The Atelier panel wears the house default, so `<Icon>` here would draw the
 * default; each glyph is painted directly from the file it resolves to.
 *
 * @module components/theme-editor/assets/IconsSection
 */

import { useId, useMemo, useState, type CSSProperties } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { ICON_REGISTRY, type IconName } from '@/components/ui/icons/icon-registry'
import { themeDraftAction, themeDraftUpload, type DraftDetail } from '../use-theme-drafts'
import { useDraftOperations } from './use-draft-operations'
import { ICON_EXTENSIONS, iconOverrides, imageUrl, isTintedIcon } from './model'
import { ConfirmRemoveDialog, FileChooser } from './shared'

const ICON_NAMES = Object.keys(ICON_REGISTRY) as IconName[]

interface Glyph {
  url: string | null
  tinted: boolean
}

/** How the app paints a glyph: a mask over the text colour, or the picture as it is. */
function glyphStyle({ url, tinted }: Glyph): CSSProperties {
  if (!url) return {}
  const src = `url("${url}")`
  return tinted
    ? { backgroundColor: 'currentColor', maskImage: src, WebkitMaskImage: src, maskSize: 'contain', WebkitMaskSize: 'contain', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat', maskPosition: 'center', WebkitMaskPosition: 'center' }
    : { backgroundImage: src, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' }
}

function IconGlyph({ glyph, className = 'w-6 h-6' }: { glyph: Glyph; className?: string }) {
  return <span aria-hidden="true" className={`inline-block ${className}`} style={glyphStyle(glyph)} />
}

export function IconsSection({ detail }: { detail: DraftDetail }) {
  const ops = useDraftOperations()
  const searchId = useId()
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<IconName | null>(null)
  const [removing, setRemoving] = useState<IconName | null>(null)
  const [error, setError] = useState<string | null>(null)
  const overrides = useMemo(() => iconOverrides(detail.manifest), [detail.manifest])
  const overriddenCount = ICON_NAMES.filter((n) => overrides[n]).length

  const glyphFor = (name: IconName): Glyph => {
    const path = overrides[name]
    if (path) return { url: imageUrl(detail, path), tinted: isTintedIcon(path) }
    const def = ICON_REGISTRY[name]
    return { url: def.defaultFile, tinted: def.defaultMode === 'mask' }
  }

  const q = query.trim().toLowerCase()
  const shown = q ? ICON_NAMES.filter((n) => n.includes(q)) : ICON_NAMES

  const upload = async (name: IconName, file: File) => {
    setError(null)
    const result = await ops.run((manifestRevision, id) => themeDraftUpload<{ draft: DraftDetail; path?: string }>(id, 'set-icon', file, { manifestRevision, name }), { toast: false })
    if (result.ok) setChosen(null)
    else setError(result.message)
  }

  return (
    <div className="px-4 pb-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <label htmlFor={searchId} className="sr-only">Search the icons by name</label>
        <input
          id={searchId}
          type="search"
          className="qt-input qt-text-small min-w-0 flex-1"
          placeholder="Search the icons by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="qt-text-xs qt-text-secondary">
          {overriddenCount} of {ICON_NAMES.length} redrawn by this theme
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="qt-text-small qt-text-muted">No icon goes by that name.</p>
      ) : (
        <ul className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))]" aria-label="Icons">
          {shown.map((name) => {
            const overridden = Boolean(overrides[name])
            return (
              <li key={name}>
                <button
                  type="button"
                  className={`qt-card w-full p-2 flex flex-col items-center gap-1 ${overridden ? 'qt-border-primary' : ''}`}
                  onClick={() => {
                    setError(null)
                    setChosen(name)
                  }}
                  aria-label={`${name}${overridden ? ', redrawn by this theme' : ''}`}
                >
                  <IconGlyph glyph={glyphFor(name)} />
                  <span className="qt-text-xs break-all">{name}</span>
                  {overridden && <span className="qt-badge-primary">Redrawn</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <BaseModal
        isOpen={chosen !== null}
        onClose={() => {
          if (!ops.busy) setChosen(null)
        }}
        title={chosen ? `The ${chosen} icon` : ''}
        subtitle={chosen && overrides[chosen] ? `Redrawn by this theme from ${overrides[chosen]}` : 'Drawn as Quilltap draws it'}
        busy={ops.busy}
        footer={
          chosen && (
            <div className="flex gap-2 justify-between flex-wrap">
              <div>
                {overrides[chosen] && (
                  <button
                    type="button"
                    className="qt-button qt-button-ghost"
                    disabled={ops.busy}
                    onClick={() => {
                      setRemoving(chosen)
                      setChosen(null)
                    }}
                  >
                    Remove the override
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button type="button" className="qt-button qt-button-secondary" onClick={() => setChosen(null)} disabled={ops.busy}>
                  Close
                </button>
                <FileChooser
                  label={overrides[chosen] ? 'Upload another' : 'Upload a replacement'}
                  accept={ICON_EXTENSIONS.join(',')}
                  className="qt-button qt-button-primary"
                  disabled={ops.busy}
                  onFiles={([file]) => void upload(chosen, file)}
                />
              </div>
            </div>
          )
        }
      >
        {chosen && (
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <IconGlyph glyph={glyphFor(chosen)} className="w-12 h-12" />
              <IconGlyph glyph={glyphFor(chosen)} className="w-6 h-6" />
              <span className="qt-text-brand inline-flex">
                <IconGlyph glyph={glyphFor(chosen)} className="w-6 h-6" />
              </span>
            </div>
            <p className="qt-text-small">
              An SVG is drawn in the colour of the text around it, as Quilltap&rsquo;s own icons are, so draw it in one colour on a
              clear ground. A WebP is drawn exactly as it is, colours and all.
            </p>
            {error && <p role="alert" className="qt-text-small qt-text-destructive">{error}</p>}
          </div>
        )}
      </BaseModal>

      <ConfirmRemoveDialog
        subject={removing}
        title="Remove this override?"
        body={removing && <p>The {removing} icon goes back to Quilltap&rsquo;s own, and its file leaves the draft unless something else uses it.</p>}
        onConfirm={async () => {
          if (!removing) return false
          const name = removing
          const result = await ops.run((manifestRevision, id) => themeDraftAction(id, 'clear-icon', { manifestRevision, name }))
          return result.ok
        }}
        onClose={() => setRemoving(null)}
      />
    </div>
  )
}
