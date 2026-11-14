'use client'

/**
 * The Metadata card: the character's freeform fact sheet, the vault's
 * `metadata.json` — flat user-authored keys Pascal's outcome tables test as
 * `when.metadata.<key>`. The card lists the keys; *Edit metadata.json…* opens
 * a modal with the JSON (a modal, so it has the page's one kind of Save).
 *
 * The reserved `progressions` key is the Progressions card's to edit, so it is
 * kept out of the editor. Save sends a key-level patch
 * (`?action=patch-metadata`): the keys the editor holds are set, the keys it
 * opened with and no longer holds are unset, and nothing else is touched — so
 * the progressions, and any key a character's doc_* edit or a Pascal write
 * added meanwhile, survive, and this card cannot race the Progressions card.
 *
 * @module app/aurora/[id]/cards/MetadataCard
 */

import { useId, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BaseModal } from '@/components/ui/BaseModal'
import { apiErrorMessage, apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { PROGRESSIONS_METADATA_KEY } from '@/lib/progressions/schema'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { SectionCard } from '../components/SectionCard'
import { useCharacterPage } from '../CharacterPageContext'

type MetadataObject = Record<string, unknown>

function asObject(value: unknown): MetadataObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as MetadataObject) : {}
}

/** The keys this editor owns: everything but the reserved `progressions`. */
export function editableMetadata(metadata: unknown): MetadataObject {
  const { [PROGRESSIONS_METADATA_KEY]: _reserved, ...rest } = asObject(metadata)
  return rest
}

/**
 * Parse the editor's text into the object to store, or an error message.
 * Refuses anything but a JSON object, and the reserved key.
 */
export function parseMetadataDraft(text: string): { value: MetadataObject } | { error: string } {
  const trimmed = text.trim()
  if (trimmed === '') return { value: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    return { error: `That is not valid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: 'metadata.json must be a JSON object — { "key": value, … }.' }
  }
  if (PROGRESSIONS_METADATA_KEY in parsed) {
    return { error: `"${PROGRESSIONS_METADATA_KEY}" is reserved; edit progressions on the Progressions card.` }
  }
  return { value: parsed as MetadataObject }
}

/** The key-level patch a save sends: set every edited key, unset the ones removed. */
export function metadataPatchForSave(
  edited: MetadataObject,
  openedKeys: readonly string[],
): { set: MetadataObject; unset: string[] } {
  return { set: { ...edited }, unset: openedKeys.filter((key) => !(key in edited)) }
}

interface CharacterResponse {
  character?: { metadata?: unknown }
}

export function MetadataCard() {
  const { characterId, character, readOnly, reload } = useCharacterPage()
  const queryClient = useQueryClient()
  const textareaId = useId()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [openedKeys, setOpenedKeys] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const keys = Object.keys(editableMetadata(character.metadata))

  const openEditor = async () => {
    // Start from the file as it is now, not the page's copy: a character's
    // doc_* edit or a Pascal write may have landed since the page loaded.
    let source: unknown = character.metadata
    try {
      const fresh = await apiFetch<CharacterResponse>(`/api/v1/characters/${characterId}`, { cache: 'no-store' })
      source = fresh.character?.metadata
    } catch {
      // Fall back to the page's copy; Save re-reads before it writes anyway.
    }
    const current = editableMetadata(source)
    setOpenedKeys(Object.keys(current))
    setDraft(Object.keys(current).length === 0 ? '{\n  \n}' : JSON.stringify(current, null, 2))
    setError(null)
    setOpen(true)
  }

  const save = async () => {
    const parsed = parseMetadataDraft(draft)
    if ('error' in parsed) {
      setError(parsed.error)
      return
    }
    setSaving(true)
    try {
      await apiFetch<unknown>(`/api/v1/characters/${characterId}?action=patch-metadata`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metadataPatchForSave(parsed.value, openedKeys)),
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.characters.detail(characterId) })
      await reload()
      showSuccessToast('metadata.json saved.')
      setOpen(false)
    } catch (err) {
      const message = apiErrorMessage(err, 'metadata.json could not be saved.')
      setError(message)
      showErrorToast(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard
      title="Metadata"
      anchor="metadata"
      description={
        <>
          The freeform fact sheet in the vault&rsquo;s <code>metadata.json</code>: keys of your own that
          Pascal&rsquo;s custom tools can test (<code>when.metadata.&lt;key&gt;</code>). It never reaches a model
          as written. Progressions live here too, under their own card.
        </>
      }
      actions={
        <button
          type="button"
          className="qt-button-secondary"
          onClick={() => void openEditor()}
          disabled={readOnly || !character.characterDocumentMountPointId}
          title={
            character.characterDocumentMountPointId
              ? 'Edit the keys in metadata.json'
              : 'This character has no vault yet; save any particular once to provision one.'
          }
        >
          Edit metadata.json…
        </button>
      }
    >
      {keys.length === 0 ? (
        <p className="qt-text-small qt-text-secondary">No keys of your own yet.</p>
      ) : (
        <p className="qt-text-small">
          {keys.length === 1 ? '1 key' : `${keys.length} keys`}:{' '}
          {keys.map((key, i) => (
            <span key={key}>
              {i > 0 && ', '}
              <code>{key}</code>
            </span>
          ))}
        </p>
      )}

      <BaseModal
        isOpen={open}
        onClose={() => !saving && setOpen(false)}
        title={`metadata.json — ${character.name}`}
        maxWidth="2xl"
        showCloseButton
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="qt-button-secondary" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="qt-button-primary" onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        }
      >
        <div className="space-y-2">
          <label htmlFor={textareaId} className="qt-label block">
            Keys (a JSON object)
          </label>
          <textarea
            id={textareaId}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              if (error) setError(null)
            }}
            spellCheck={false}
            rows={14}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${textareaId}-hint`}
            className={`qt-input font-mono text-sm ${error ? 'qt-border-destructive' : ''}`}
          />
          <p id={`${textareaId}-hint`} className={`qt-text-small ${error ? 'qt-text-destructive' : 'qt-text-secondary'}`}>
            {error ??
              `The "${PROGRESSIONS_METADATA_KEY}" key is kept as it is and edited on the Progressions card.`}
          </p>
        </div>
      </BaseModal>
    </SectionCard>
  )
}
