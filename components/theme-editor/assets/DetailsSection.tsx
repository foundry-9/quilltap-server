'use client'

/**
 * Calliope's Atelier — the Subsystems and details section (Spec F, Stage 1).
 *
 * Per subsystem: its name, description, thumbnail and background picture
 * (one of the draft's pictures, "none", or Quilltap's own). Then the
 * manifest's own details: author, licence, tags and whether the theme has a
 * dark mode. Each part saves through its named draft operation
 * (`set-subsystem`, `set-manifest`); what is being typed survives a refetch
 * (`useDraft`).
 *
 * @module components/theme-editor/assets/DetailsSection
 */

import { useId, useMemo, useState } from 'react'
import { DEFAULT_SUBSYSTEM_DEFINITIONS, type SubsystemId } from '@/lib/foundry/subsystem-defaults'
import { useDraft } from '@/lib/hooks/use-draft'
import { themeDraftAction, type DraftDetail } from '../use-theme-drafts'
import { useDraftOperations } from './use-draft-operations'
import { authorValue, imageUrl, parseTags, pictureFiles, readAuthor, readTags, subsystemFields } from './model'

const SUBSYSTEM_IDS = Object.keys(DEFAULT_SUBSYSTEM_DEFINITIONS) as SubsystemId[]

/** What the dark-mode switch does, from how the app treats `supportsDarkMode` today. */
export const DARK_MODE_EXPLAINED =
  'This is a label, not a lock. Unticked, the Appearance settings show the theme in light only and without the dark-mode badge. A reader who prefers the dark still sees it dark: Quilltap draws the dark mode from this theme’s dark values where it sets them, and from the house defaults where it does not.'

export function DetailsSection({ detail }: { detail: DraftDetail }) {
  const [open, setOpen] = useState<SubsystemId | null>(null)
  const headingId = useId()
  return (
    <div className="px-4 pb-4 space-y-4">
      <ManifestDetails detail={detail} />
      <section aria-labelledby={headingId} className="space-y-2">
        <h4 id={headingId} className="qt-heading-4">Subsystems</h4>
        <p className="qt-text-xs qt-text-secondary">
          What each part of Quilltap is called under this theme, and the pictures it wears on the Foundry and on its own page. Anything left
          alone stays as Quilltap has it.
        </p>
        <ul className="space-y-2">
          {SUBSYSTEM_IDS.map((sid) => (
            <li key={sid} className="qt-card">
              <details open={open === sid} onToggle={(e) => {
                  if (e.currentTarget.open) setOpen(sid)
                  else if (open === sid) setOpen(null)
                }}>
                <summary className="p-3 cursor-pointer qt-text-small">
                  <SubsystemSummary detail={detail} id={sid} />
                </summary>
                {open === sid && <SubsystemForm detail={detail} id={sid} />}
              </details>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function SubsystemSummary({ detail, id }: { detail: DraftDetail; id: SubsystemId }) {
  const fields = subsystemFields(detail.manifest, id)
  const changed = Object.values(fields).filter(Boolean).length
  return (
    <>
      <span className="font-medium">{fields.name || DEFAULT_SUBSYSTEM_DEFINITIONS[id].name}</span>
      {fields.name && <span className="qt-text-xs qt-text-muted"> (Quilltap calls it {DEFAULT_SUBSYSTEM_DEFINITIONS[id].name})</span>}
      {changed > 0 && <span className="qt-badge-secondary ml-2">{changed} changed</span>}
    </>
  )
}

const DEFAULT_PICTURE = ''
const NO_PICTURE = 'none'

function SubsystemForm({ detail, id }: { detail: DraftDetail; id: SubsystemId }) {
  const ops = useDraftOperations()
  const baseId = useId()
  const def = DEFAULT_SUBSYSTEM_DEFINITIONS[id]
  const server = useMemo(() => subsystemFields(detail.manifest, id), [detail.manifest, id])
  const [fields, setFields, { dirty }] = useDraft(server)
  const pictures = pictureFiles(detail.files).map((f) => f.path)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setError(null)
    const changed: Record<string, string> = {}
    for (const key of ['name', 'description', 'thumbnail', 'backgroundImage'] as const) if (fields[key] !== server[key]) changed[key] = fields[key]
    const result = await ops.run((manifestRevision, draftId) => themeDraftAction(draftId, 'set-subsystem', { manifestRevision, subsystem: id, fields: changed }), {
      toast: false,
    })
    if (!result.ok) setError(result.message)
  }

  const pictureField = (key: 'thumbnail' | 'backgroundImage', label: string, fallback: string) => {
    const value = fields[key]
    const options = value && value !== NO_PICTURE && !pictures.includes(value) ? [...pictures, value] : pictures
    const shown = value === NO_PICTURE ? null : value ? imageUrl(detail, value) : fallback
    return (
      <div className="space-y-1">
        <label htmlFor={`${baseId}-${key}`} className="qt-label">{label}</label>
        <select id={`${baseId}-${key}`} className="qt-select w-full" value={value} onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}>
          <option value={DEFAULT_PICTURE}>Quilltap&rsquo;s own</option>
          <option value={NO_PICTURE}>None</option>
          {options.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <div className="h-16 w-28 qt-bg-muted rounded overflow-hidden flex items-center justify-center">
          {shown ? <img src={shown} alt="" className="max-w-full max-h-full object-cover" /> : <span className="qt-text-xs qt-text-muted">No picture</span>}
        </div>
      </div>
    )
  }

  return (
    <div className="px-3 pb-3 space-y-3">
      <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]">
        <div>
          <label htmlFor={`${baseId}-name`} className="qt-label">Name</label>
          <input
            id={`${baseId}-name`}
            className="qt-input w-full"
            value={fields.name}
            maxLength={100}
            placeholder={def.name}
            onChange={(e) => setFields((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div>
          <label htmlFor={`${baseId}-description`} className="qt-label">Description</label>
          <input
            id={`${baseId}-description`}
            className="qt-input w-full"
            value={fields.description}
            maxLength={500}
            placeholder={def.description}
            onChange={(e) => setFields((f) => ({ ...f, description: e.target.value }))}
          />
        </div>
        {pictureField('thumbnail', 'Thumbnail on the Foundry', def.thumbnail)}
        {pictureField('backgroundImage', 'Background picture on its page', def.backgroundImage)}
      </div>
      <p className="qt-text-xs qt-text-secondary">An empty name or description keeps Quilltap&rsquo;s own, shown greyed in the box.</p>
      {error && <p role="alert" className="qt-text-small qt-text-destructive">{error}</p>}
      <div className="flex justify-end">
        <button type="button" className="qt-button qt-button-primary qt-button-sm" disabled={!dirty || ops.busy} onClick={() => void save()}>
          Save {def.name}
        </button>
      </div>
    </div>
  )
}

interface ManifestForm {
  authorName: string
  authorEmail: string
  authorUrl: string
  license: string
  tags: string
  supportsDarkMode: boolean
}

function manifestForm(manifest: Record<string, unknown> | null): ManifestForm {
  const author = readAuthor(manifest)
  return {
    authorName: author.name,
    authorEmail: author.email,
    authorUrl: author.url,
    license: typeof manifest?.license === 'string' ? manifest.license : '',
    tags: readTags(manifest).join(', '),
    supportsDarkMode: manifest?.supportsDarkMode !== false,
  }
}

function ManifestDetails({ detail }: { detail: DraftDetail }) {
  const ops = useDraftOperations()
  const baseId = useId()
  const server = useMemo(() => manifestForm(detail.manifest), [detail.manifest])
  const [form, setForm, { dirty }] = useDraft(server)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof ManifestForm>(key: K, value: ManifestForm[K]) => setForm((f) => ({ ...f, [key]: value }))
  const tags = parseTags(form.tags)
  const tooManyTags = tags.length > 20 || tags.some((t) => t.length > 40)
  const author = authorValue({ name: form.authorName, email: form.authorEmail, url: form.authorUrl })
  const authorCleared = !author && server.authorName !== ''

  const save = async () => {
    setError(null)
    const fields: Record<string, unknown> = {}
    if (form.authorName !== server.authorName || form.authorEmail !== server.authorEmail || form.authorUrl !== server.authorUrl) {
      if (author) fields.author = author
    }
    if (form.license !== server.license) fields.license = form.license.trim() || null
    if (form.tags !== server.tags) fields.tags = tags
    if (form.supportsDarkMode !== server.supportsDarkMode) fields.supportsDarkMode = form.supportsDarkMode
    const result = await ops.run((manifestRevision, id) => themeDraftAction(id, 'set-manifest', { manifestRevision, fields }), { toast: false })
    if (!result.ok) setError(result.message)
  }

  return (
    <section aria-labelledby={`${baseId}-heading`} className="qt-card p-3 space-y-3">
      <h4 id={`${baseId}-heading`} className="qt-heading-4">The theme&rsquo;s details</h4>
      <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]">
        <div>
          <label htmlFor={`${baseId}-author`} className="qt-label">Author</label>
          <input id={`${baseId}-author`} className="qt-input w-full" value={form.authorName} maxLength={200} onChange={(e) => set('authorName', e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${baseId}-email`} className="qt-label">Author&rsquo;s email (optional)</label>
          <input id={`${baseId}-email`} type="email" className="qt-input w-full" value={form.authorEmail} maxLength={200} onChange={(e) => set('authorEmail', e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${baseId}-url`} className="qt-label">Author&rsquo;s web address (optional)</label>
          <input id={`${baseId}-url`} type="url" className="qt-input w-full" value={form.authorUrl} maxLength={500} onChange={(e) => set('authorUrl', e.target.value)} />
        </div>
      </div>
      {authorCleared && <p className="qt-text-xs qt-text-warning">A theme keeps its author once named; give another name rather than none.</p>}
      <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]">
        <div>
          <label htmlFor={`${baseId}-licence`} className="qt-label">The theme&rsquo;s licence</label>
          <input
            id={`${baseId}-licence`}
            className="qt-input w-full"
            value={form.license}
            maxLength={200}
            placeholder="e.g. MIT, or CC-BY-4.0"
            aria-describedby={`${baseId}-licence-help`}
            onChange={(e) => set('license', e.target.value)}
          />
          <p id={`${baseId}-licence-help`} className="qt-text-xs qt-text-secondary mt-1">
            For the theme itself; each font names its own licence in Fonts.
          </p>
        </div>
        <div>
          <label htmlFor={`${baseId}-tags`} className="qt-label">Tags</label>
          <input
            id={`${baseId}-tags`}
            className="qt-input w-full"
            value={form.tags}
            placeholder="dark, serif, art deco"
            aria-describedby={`${baseId}-tags-help`}
            aria-invalid={tooManyTags || undefined}
            onChange={(e) => set('tags', e.target.value)}
          />
          <p id={`${baseId}-tags-help`} className={`qt-text-xs mt-1 ${tooManyTags ? 'qt-text-destructive' : 'qt-text-secondary'}`}>
            Separated by commas; at most 20, each under 40 letters.
          </p>
        </div>
      </div>
      <div className="space-y-1">
        <label className="qt-text-small flex items-center gap-2">
          <input type="checkbox" checked={form.supportsDarkMode} aria-describedby={`${baseId}-dark-help`} onChange={(e) => set('supportsDarkMode', e.target.checked)} />
          This theme has a dark mode
        </label>
        <p id={`${baseId}-dark-help`} className="qt-text-xs qt-text-secondary">{DARK_MODE_EXPLAINED}</p>
      </div>
      {error && <p role="alert" className="qt-text-small qt-text-destructive">{error}</p>}
      <div className="flex justify-end">
        <button type="button" className="qt-button qt-button-primary qt-button-sm" disabled={!dirty || ops.busy || tooManyTags} onClick={() => void save()}>
          Save the details
        </button>
      </div>
    </section>
  )
}
