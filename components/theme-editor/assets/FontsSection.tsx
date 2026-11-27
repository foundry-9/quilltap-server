'use client'

/**
 * Calliope's Atelier — the Fonts section (Spec F, Stage 1).
 *
 * One card per family the manifest declares, listing its faces (weight,
 * style, licence, file) with a sample line in each; "Add font" reads each
 * chosen file (decision 1), lets the author correct what was read, and asks
 * for the licence once for the batch (decision 4). A font whose own tables
 * forbid embedding is flagged; a `.ttf` or `.otf` is marked as becoming
 * WOFF2 at install (decision 2); a family no font-family token names says so.
 *
 * @module components/theme-editor/assets/FontsSection
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import { formatFontFamily, type ThemeTokensDocument } from '@/lib/themes/engine/client'
import type { UploadedFontReading } from '@/lib/themes/drafts/operations'
import { formatBytes } from '@/lib/utils/format-bytes'
import { themeDraftAction, themeDraftUpload, type DraftDetail } from '../use-theme-drafts'
import { useDraftOperations } from './use-draft-operations'
import {
  FONT_EXTENSIONS,
  LICENCE_FILE_EXTENSIONS,
  PROPRIETARY,
  becomesWoff2,
  familiesInUse,
  fontEntries,
  fontFamilies,
  licenceFiles,
  licenceFromHint,
  sampleWeight,
  type FontEntry,
} from './model'
import { ConfirmRemoveDialog, FileChooser, LicencePicker, ProprietaryNote } from './shared'

const SAMPLE = 'The quick brown fox jumps over the lazy dog — 0123456789'
const STYLES = ['normal', 'italic', 'oblique'] as const
type Style = (typeof STYLES)[number]

const asStyle = (s: string | null | undefined): Style => (STYLES as readonly string[]).includes(s ?? '') ? (s as Style) : 'normal'

interface FontsSectionProps {
  detail: DraftDetail
  tokens: ThemeTokensDocument
  /** The preview is on, so the draft's faces are loaded and the samples drawn in them. */
  previewing: boolean
  /** Opens the section holding the font-family tokens. */
  onShowFontTokens: () => void
}

export function FontsSection({ detail, tokens, previewing, onShowFontTokens }: FontsSectionProps) {
  const ops = useDraftOperations()
  const entries = useMemo(() => fontEntries(detail.manifest, detail.files), [detail.manifest, detail.files])
  const families = useMemo(() => fontFamilies(entries), [entries])
  const inUse = useMemo(() => familiesInUse(tokens), [tokens])
  const [adding, setAdding] = useState<File[] | null>(null)
  const [editing, setEditing] = useState<FontEntry | null>(null)
  const [removing, setRemoving] = useState<FontEntry | null>(null)
  const anyProprietary = entries.some((e) => e.license === PROPRIETARY)

  return (
    <div className="px-4 pb-4 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <FileChooser label="Add font" accept={FONT_EXTENSIONS.join(',')} multiple disabled={ops.busy} onFiles={setAdding} />
        <span className="qt-text-xs qt-text-secondary">WOFF2, WOFF, TrueType or OpenType; several at once for a family&rsquo;s weights.</span>
      </div>
      {anyProprietary && <ProprietaryNote />}
      {!previewing && families.length > 0 && (
        <p className="qt-text-xs qt-text-muted">The samples are drawn in the draft&rsquo;s fonts while the preview is on.</p>
      )}
      {families.length === 0 ? (
        <p className="qt-text-small qt-text-muted">This theme carries no fonts of its own; it sets type in fonts the reader already has.</p>
      ) : (
        families.map(({ family, faces }) => (
          <section key={family.toLowerCase()} className="qt-card p-3 space-y-2" aria-label={`Font family ${family}`}>
            <h4 className="qt-heading-4">{family}</h4>
            {!inUse.has(family.toLowerCase()) && (
              <p className="qt-text-xs qt-text-warning flex items-center gap-2 flex-wrap">
                No font-family token names this family yet, so nothing is set in it.
                <button type="button" className="qt-button qt-button-ghost qt-button-sm" onClick={onShowFontTokens}>
                  Open the font stacks
                </button>
              </p>
            )}
            <ul className="space-y-3">
              {faces.map((face) => (
                <FontFaceRow
                  key={face.index}
                  face={face}
                  disabled={ops.busy}
                  onEdit={() => setEditing(face)}
                  onRemove={() => setRemoving(face)}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      <AddFontDialog files={adding} detail={detail} onClose={() => setAdding(null)} />
      <EditFontDialog face={editing} detail={detail} onClose={() => setEditing(null)} />
      <ConfirmRemoveDialog
        subject={removing ? removing.family : null}
        title="Remove this font?"
        body={
          removing && (
            <>
              <p>
                {removing.family} {removing.weight ?? '400'} {removing.style ?? 'normal'} leaves the theme&rsquo;s font list.
              </p>
              <p>Its file goes with it unless something else still names it.</p>
            </>
          )
        }
        onConfirm={async () => {
          if (!removing) return false
          const result = await ops.run((manifestRevision, id) => themeDraftAction(id, 'remove-font', { manifestRevision, index: removing.index }))
          return result.ok
        }}
        onClose={() => setRemoving(null)}
      />
    </div>
  )
}

interface FontFaceRowProps {
  face: FontEntry
  disabled: boolean
  onEdit: () => void
  onRemove: () => void
}

function FontFaceRow({ face, disabled, onEdit, onRemove }: FontFaceRowProps) {
  const facts = face.file?.font ?? null
  return (
    <li className="border-t qt-border-default pt-2 space-y-1">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="qt-text-small">
          <span className="font-medium">Weight {face.weight ?? '400'}</span>, {face.style ?? 'normal'}
          <span className="qt-text-secondary"> · {face.license ?? 'no licence named'}</span>
          {face.licenseFile && <span className="qt-text-secondary"> · licence text in {face.licenseFile}</span>}
          <div className="qt-text-xs qt-text-muted font-mono">
            {face.src}
            {face.file ? ` · ${formatBytes(face.file.size)}` : ' · the file is missing'}
          </div>
        </div>
        <div className="flex gap-1">
          <button type="button" className="qt-button qt-button-ghost qt-button-sm" onClick={onEdit} disabled={disabled} aria-label={`Edit ${face.family} ${face.weight ?? '400'} ${face.style ?? 'normal'}`}>
            Edit
          </button>
          <button type="button" className="qt-button qt-button-ghost qt-button-sm" onClick={onRemove} disabled={disabled} aria-label={`Remove ${face.family} ${face.weight ?? '400'} ${face.style ?? 'normal'}`}>
            Remove
          </button>
        </div>
      </div>
      <p
        className="qt-text-large truncate"
        style={{ fontFamily: `${formatFontFamily(face.family)}, system-ui`, fontWeight: sampleWeight(face.weight), fontStyle: asStyle(face.style) }}
      >
        {SAMPLE}
      </p>
      <div className="flex gap-2 flex-wrap">
        {facts?.embedding === 'restricted' && (
          <span className="qt-badge-warning">The font&rsquo;s own tables forbid embedding</span>
        )}
        {becomesWoff2(face.src) && <span className="qt-badge-info">Becomes WOFF2 at install</span>}
        {facts?.variable && <span className="qt-badge-secondary">Variable</span>}
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Adding

interface PendingFont {
  file: File
  status: 'reading' | 'ready' | 'added' | 'failed'
  family: string
  weight: string
  style: Style
  /** Fields taken from the file name because the font could not be read. */
  guessed: boolean
  reason: string | null
  restricted: boolean
  licenceHint: string | null
  error: string | null
}

interface AddFontDialogProps {
  files: File[] | null
  detail: DraftDetail
  onClose: () => void
}

/** Adds one or several fonts: each read, corrected if need be, under one licence. */
function AddFontDialog({ files, detail, onClose }: AddFontDialogProps) {
  const isOpen = files !== null
  // Keyed by the chosen batch, so a new choice starts the dialog afresh.
  return isOpen ? <AddFontForm key={files.map((f) => `${f.name}:${f.size}`).join('|')} files={files} detail={detail} onClose={onClose} /> : null
}

function AddFontForm({ files, detail, onClose }: { files: File[]; detail: DraftDetail; onClose: () => void }) {
  const ops = useDraftOperations()
  const baseId = useId()
  const [rows, setRows] = useState<PendingFont[]>(() =>
    files.map((file) => ({
      file,
      status: 'reading',
      family: '',
      weight: '400',
      style: 'normal',
      guessed: false,
      reason: null,
      restricted: false,
      licenceHint: null,
      error: null,
    })),
  )
  const [licence, setLicence] = useState('')
  const [licenceFile, setLicenceFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  // Read each file once, when the dialog opens.
  const draftId = detail.id
  useEffect(() => {
    if (started.current) return
    started.current = true
    void Promise.all(
      files.map(async (file, i) => {
        let next: Partial<PendingFont>
        try {
          const { font } = await themeDraftUpload<{ font: UploadedFontReading }>(draftId, 'read-font', file, {})
          next = font.read
            ? {
                status: 'ready',
                family: font.info.family,
                weight: font.info.weight,
                style: asStyle(font.info.style),
                restricted: font.info.embedding === 'restricted',
                licenceHint: font.info.licence,
              }
            : { status: 'ready', family: font.guess.family, weight: font.guess.weight, style: asStyle(font.guess.style), guessed: true, reason: font.reason }
        } catch (err) {
          next = { status: 'failed', error: err instanceof Error ? err.message : 'The font could not be read.' }
        }
        setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...next } : r)))
        return next.licenceHint ?? null
      }),
    ).then((hints) => {
      const named = hints.map(licenceFromHint).find((l) => l !== null)
      if (named) setLicence((current) => current || named)
    })
  }, [files, draftId])

  const update = (i: number, part: Partial<PendingFont>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...part } : r)))
  const reading = rows.some((r) => r.status === 'reading')
  const toAdd = rows.filter((r) => r.status === 'ready')
  const canAdd = !busy && !reading && toAdd.length > 0 && licence.trim() !== '' && toAdd.every((r) => r.family.trim() !== '')

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      let licensePath: string | undefined
      if (licenceFile) {
        const result = await ops.run(
          (manifestRevision, id) => themeDraftUpload<{ draft: DraftDetail; path?: string }>(id, 'add-licence-file', licenceFile, { manifestRevision }),
          { toast: false },
        )
        if (!result.ok) {
          setError(`The licence file: ${result.message}`)
          return
        }
        licensePath = result.value.path
        setLicenceFile(null)
      }
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        if (row.status !== 'ready') continue
        const result = await ops.run(
          (manifestRevision, id) =>
            themeDraftUpload<{ draft: DraftDetail; path?: string }>(id, 'add-font', row.file, {
              manifestRevision,
              license: licence.trim(),
              family: row.family.trim(),
              weight: row.weight.trim() || undefined,
              style: row.style,
              licenseFile: licensePath,
            }),
          { toast: false },
        )
        if (!result.ok) {
          update(i, { status: result.conflict ? 'ready' : 'failed', error: result.message })
          if (result.conflict) setError(result.message)
          return
        }
        update(i, { status: 'added', error: null })
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <BaseModal
      isOpen
      onClose={() => {
        if (!busy) onClose()
      }}
      title="Add fonts"
      subtitle="Here is what each file says it is. Correct anything amiss, then name the licence they come under."
      maxWidth="2xl"
      busy={busy}
      footer={
        <div className="flex gap-2 justify-end">
          <button type="button" className="qt-button qt-button-secondary" onClick={onClose} disabled={busy}>
            {rows.some((r) => r.status === 'added') ? 'Done' : 'Cancel'}
          </button>
          <button type="button" className="qt-button qt-button-primary" onClick={submit} disabled={!canAdd}>
            {busy ? 'Adding…' : toAdd.length === 1 ? 'Add the font' : `Add ${toAdd.length} fonts`}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <ul className="space-y-3">
          {rows.map((row, i) => (
            <li key={i} className="qt-card p-3 space-y-2" aria-label={row.file.name}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-mono qt-text-small">{row.file.name}</span>
                <span className="qt-text-xs qt-text-muted">
                  {formatBytes(row.file.size)}
                  {row.status === 'reading' && ' · reading…'}
                  {row.status === 'added' && ' · added'}
                </span>
              </div>
              {row.status !== 'reading' && row.status !== 'added' && row.error === null && (
                <>
                  {row.guessed && (
                    <p className="qt-text-xs qt-text-warning">
                      The font&rsquo;s own tables could not be read{row.reason ? ` (${row.reason})` : ''}; the family, weight and
                      style below are guessed from the file name. Check them.
                    </p>
                  )}
                  <div className="grid gap-2 @xl:grid-cols-[2fr_1fr_1fr]">
                    <div>
                      <label htmlFor={`${baseId}-${i}-family`} className="qt-label">
                        Family{row.guessed && <span className="qt-text-xs qt-text-warning"> (guessed)</span>}
                      </label>
                      <input id={`${baseId}-${i}-family`} className="qt-input w-full" value={row.family} maxLength={100} onChange={(e) => update(i, { family: e.target.value })} />
                    </div>
                    <div>
                      <label htmlFor={`${baseId}-${i}-weight`} className="qt-label">
                        Weight{row.guessed && <span className="qt-text-xs qt-text-warning"> (guessed)</span>}
                      </label>
                      <input id={`${baseId}-${i}-weight`} className="qt-input w-full" value={row.weight} maxLength={20} placeholder="400, or 100 900" onChange={(e) => update(i, { weight: e.target.value })} />
                    </div>
                    <div>
                      <label htmlFor={`${baseId}-${i}-style`} className="qt-label">
                        Style{row.guessed && <span className="qt-text-xs qt-text-warning"> (guessed)</span>}
                      </label>
                      <select id={`${baseId}-${i}-style`} className="qt-select w-full" value={row.style} onChange={(e) => update(i, { style: asStyle(e.target.value) })}>
                        {STYLES.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {row.restricted && <span className="qt-badge-warning">The font&rsquo;s own tables forbid embedding</span>}
                    {becomesWoff2(row.file.name) && <span className="qt-badge-info">Becomes WOFF2 at install; the draft keeps this file</span>}
                  </div>
                </>
              )}
              {row.error && <p role="alert" className="qt-text-small qt-text-destructive">{row.error}</p>}
            </li>
          ))}
        </ul>
        <LicencePicker value={licence} onChange={setLicence} label="Licence, for every font above" />
        {licence === PROPRIETARY && <ProprietaryNote />}
        <div className="flex items-center gap-2 flex-wrap">
          <FileChooser
            label={licenceFile ? 'Choose another licence file' : 'Attach a licence file'}
            accept={LICENCE_FILE_EXTENSIONS.join(',')}
            disabled={busy}
            onFiles={([f]) => setLicenceFile(f)}
          />
          <span className="qt-text-xs qt-text-secondary">
            {licenceFile ? `${licenceFile.name} goes in with them.` : 'Optional: the licence text (.txt or .md), kept beside the fonts.'}
          </span>
        </div>
        {error && <p role="alert" className="qt-text-small qt-text-destructive">{error}</p>}
      </div>
    </BaseModal>
  )
}

// ---------------------------------------------------------------------------
// Editing

const NO_FILE = ''

function EditFontDialog({ face, detail, onClose }: { face: FontEntry | null; detail: DraftDetail; onClose: () => void }) {
  return face ? <EditFontForm key={face.index} face={face} detail={detail} onClose={onClose} /> : null
}

function EditFontForm({ face, detail, onClose }: { face: FontEntry; detail: DraftDetail; onClose: () => void }) {
  const ops = useDraftOperations()
  const baseId = useId()
  const [family, setFamily] = useState(face.family)
  const [weight, setWeight] = useState(face.weight ?? '')
  const [style, setStyle] = useState<Style>(asStyle(face.style))
  const [licence, setLicence] = useState(face.license ?? '')
  const [licenseFile, setLicenseFile] = useState(face.licenseFile ?? NO_FILE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const files = licenceFiles(detail.files)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const fields: Record<string, unknown> = {
        family: family.trim(),
        weight: weight.trim() === '' ? null : weight.trim(),
        style,
        licenseFile: licenseFile === NO_FILE ? null : licenseFile,
      }
      if (licence.trim()) fields.license = licence.trim()
      const result = await ops.run((manifestRevision, id) => themeDraftAction(id, 'update-font', { manifestRevision, index: face.index, fields }), { toast: false })
      if (result.ok) onClose()
      else setError(result.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <BaseModal
      isOpen
      onClose={() => {
        if (!busy) onClose()
      }}
      title={`Edit ${face.family}`}
      subtitle={face.src}
      busy={busy}
      footer={
        <div className="flex gap-2 justify-end">
          <button type="button" className="qt-button qt-button-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="qt-button qt-button-primary" onClick={save} disabled={busy || family.trim() === ''}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <label htmlFor={`${baseId}-family`} className="qt-label">Family</label>
          <input id={`${baseId}-family`} className="qt-input w-full" value={family} maxLength={100} onChange={(e) => setFamily(e.target.value)} />
        </div>
        <div className="grid gap-2 @lg:grid-cols-2">
          <div>
            <label htmlFor={`${baseId}-weight`} className="qt-label">Weight</label>
            <input id={`${baseId}-weight`} className="qt-input w-full" value={weight} maxLength={20} placeholder="400, or 100 900" onChange={(e) => setWeight(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`${baseId}-style`} className="qt-label">Style</label>
            <select id={`${baseId}-style`} className="qt-select w-full" value={style} onChange={(e) => setStyle(asStyle(e.target.value))}>
              {STYLES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <LicencePicker value={licence} onChange={setLicence} />
        {licence === PROPRIETARY && <ProprietaryNote />}
        <div>
          <label htmlFor={`${baseId}-licence-file`} className="qt-label">Licence file</label>
          <select id={`${baseId}-licence-file`} className="qt-select w-full" value={licenseFile} onChange={(e) => setLicenseFile(e.target.value)}>
            <option value={NO_FILE}>None</option>
            {files.map((f) => (
              <option key={f.path} value={f.path}>{f.path}</option>
            ))}
          </select>
        </div>
        {error && <p role="alert" className="qt-text-small qt-text-destructive">{error}</p>}
      </div>
    </BaseModal>
  )
}
