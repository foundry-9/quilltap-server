'use client'

/**
 * The Atlas entry editor — create or edit one entry.
 *
 * The canonical name; the aliases (a token input); the graphic prompt — what
 * the thing looks like, for the painters — with a live count and a warning,
 * never a refusal, once it runs past {@link ATLAS_GRAPHIC_PROMPT_SOFT_LIMIT}
 * characters; the knowledge (the shared Markdown editor, typeaheads and all);
 * and the folder. Beneath the terms sit the overlap notices from
 * `?action=overlaps`: a term another reachable entry also answers to, and a
 * term that is a character's name or alias (which will never match). An
 * existing entry has a Pictures section (upload, generate, choose, delete,
 * full screen).
 *
 * A refusal for a name already filed in the tier (`NAME_TAKEN`) is shown
 * under the name, where the remedy is.
 *
 * @module components/atlas/atlas-entry-editor
 */

import { useId, useMemo, useState } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { queryKeys } from '@/lib/query/keys'
import {
  ATLAS_GRAPHIC_PROMPT_SOFT_LIMIT,
  normalizeAtlasAliases,
  type AtlasEntryWithOrigin,
  type AtlasOverlap,
} from '@/lib/schemas/atlas.types'
import { atlasImagesUrl, atlasOriginLabel, type AtlasContainer } from '@/lib/atlas/container'
import {
  AtlasRequestError,
  atlasRequest,
  useAtlasFolders,
  useAtlasImages,
  useAtlasOverlaps,
  type AtlasEntryBody,
} from '@/lib/hooks/use-atlas'
import { ItemFolderField } from '@/components/item-browser/ItemFolderField'
import { ItemPicturesSection, type ItemPicturesSpec } from '@/components/item-browser/ItemPicturesSection'
import type { AtlasEntryActions } from './hooks/useAtlasEntryActions'
import { describeAtlasRefusal } from './hooks/useAtlasEntryActions'
import { AtlasAliasInput } from './atlas-alias-input'
import type { AtlasLoreDraft } from '@/lib/atlas/lore-draft/request-schema'

interface AtlasEntryEditorProps {
  /** The tier a new entry is created in; an edited one's own tier. */
  container: AtlasContainer
  containerLabel: string
  /** null to create. */
  entry: AtlasEntryWithOrigin | null
  initialFolder?: string
  /** A new entry's fields, prefilled (the lore wizard's draft). Ignored when editing. */
  initialDraft?: AtlasLoreDraft
  actions: Pick<AtlasEntryActions, 'mutations'>
  onClose: () => void
  onSaved: () => void
}

interface Draft {
  name: string
  aliases: string[]
  graphicPrompt: string
  knowledge: string
  folder: string
}

function draftOf(entry: AtlasEntryWithOrigin | null, folder: string, prefill?: AtlasLoreDraft): Draft {
  const source = entry ?? prefill
  return {
    name: source?.name ?? '',
    aliases: source?.aliases ?? [],
    graphicPrompt: source?.graphicPrompt ?? '',
    knowledge: source?.knowledge ?? '',
    folder: entry?.folder ?? folder,
  }
}

const orNull = (value: string): string | null => (value.trim() ? value : null)
const fold = (term: string): string => term.trim().toLocaleLowerCase()

/** The graphic prompt's count line and, past the soft limit, its warning. Never blocks. */
export function GraphicPromptCount({ length, id }: { length: number; id?: string }) {
  const over = length > ATLAS_GRAPHIC_PROMPT_SOFT_LIMIT
  return (
    <div id={id} aria-live="polite" className="space-y-0.5">
      <p className={`qt-text-xs ${over ? 'qt-text-warning' : 'qt-text-secondary'}`}>
        {length} / {ATLAS_GRAPHIC_PROMPT_SOFT_LIMIT} characters
      </p>
      {over && (
        <p className="qt-text-xs qt-text-warning" data-testid="atlas-graphic-prompt-warning">
          Warning: past {ATLAS_GRAPHIC_PROMPT_SOFT_LIMIT} characters the painters tend to skim. It will still be saved —
          but a short, vivid sketch serves a picture better than a treatise.
        </p>
      )}
    </div>
  )
}

/** The overlap notices for the terms on the page. */
function OverlapNotices({ overlaps }: { overlaps: AtlasOverlap[] }) {
  if (overlaps.length === 0) return null
  return (
    <ul className="qt-alert-warning space-y-1 qt-text-xs" aria-label="Notices about these terms" data-testid="atlas-overlap-notices">
      {overlaps.map((overlap, i) => (
        <li key={`${overlap.kind}-${overlap.term}-${overlap.otherName}-${i}`}>
          {overlap.kind === 'character' ? (
            <>
              Note: &ldquo;{overlap.term}&rdquo; is {overlap.otherName}&rsquo;s name or alias, and a person&rsquo;s name always
              wins — this term will never match the entry.
            </>
          ) : (
            <>
              Note: another reachable entry, &ldquo;{overlap.otherName}&rdquo;
              {overlap.otherOrigin && ` (${atlasOriginLabel(overlap.otherOrigin)})`}, also answers to &ldquo;{overlap.term}&rdquo;.
              Only one of them will be told of when it is spoken.
            </>
          )}
        </li>
      ))}
    </ul>
  )
}

export function AtlasEntryEditor({
  container,
  containerLabel,
  entry,
  initialFolder = '',
  initialDraft,
  actions,
  onClose,
  onSaved,
}: AtlasEntryEditorProps) {
  const fieldId = useId()
  const [draft, setDraft] = useState<Draft>(() => draftOf(entry, initialFolder, entry ? undefined : initialDraft))
  const [saving, setSaving] = useState(false)
  const [nameRefusal, setNameRefusal] = useState<string | null>(null)
  const { folders } = useAtlasFolders(container)
  const { overlaps } = useAtlasOverlaps(entry ? container : null)

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    if (key === 'name') setNameRefusal(null)
  }

  // The notices for this entry, kept to the terms still on the page.
  const notices = useMemo(() => {
    if (!entry) return []
    const terms = new Set([draft.name, ...draft.aliases].map(fold))
    return overlaps.filter((o) => o.entryId === entry.id && terms.has(fold(o.term)))
  }, [overlaps, entry, draft.name, draft.aliases])

  const save = async () => {
    const name = draft.name.trim()
    if (!name) {
      setNameRefusal('Every entry needs a name to be found by.')
      return
    }
    const body: AtlasEntryBody = {
      name,
      // An alias that has since become the name is dropped (the server would too).
      aliases: normalizeAtlasAliases(name, draft.aliases),
      graphicPrompt: orNull(draft.graphicPrompt),
      knowledge: orNull(draft.knowledge),
      folder: draft.folder,
    }
    setSaving(true)
    try {
      if (!entry) {
        await actions.mutations.create(container, body)
        showSuccessToast(`"${name}" is inked into the Atlas`)
      } else {
        await actions.mutations.update(container, entry.id, body)
        showSuccessToast('Saved')
      }
      onSaved()
    } catch (error) {
      if (error instanceof AtlasRequestError && error.code === 'NAME_TAKEN') {
        setNameRefusal(describeAtlasRefusal(error, 'That name is taken'))
      } else {
        showErrorToast(describeAtlasRefusal(error, 'The entry would not be saved'))
      }
    } finally {
      setSaving(false)
    }
  }

  const promptCountId = `${fieldId}-prompt-count`
  const nameErrorId = `${fieldId}-name-error`

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title={entry ? `Edit ${entry.name}` : 'New Atlas entry'}
      maxWidth="2xl"
      closeOnClickOutside={!saving}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <button type="button" className="qt-button-secondary qt-button-sm" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="qt-button-primary qt-button-sm" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    >
      <div className="space-y-3">
        <p className="qt-text-xs qt-text-secondary">
          {entry ? 'Kept in' : 'Will be kept in'} {containerLabel}
        </p>

        <div className="space-y-1">
          <label className="text-sm qt-text" htmlFor={`${fieldId}-name`}>Name</label>
          <input
            id={`${fieldId}-name`}
            type="text"
            className="qt-input qt-input-sm w-full"
            value={draft.name}
            placeholder="Convertible"
            aria-invalid={nameRefusal ? true : undefined}
            aria-describedby={nameRefusal ? nameErrorId : undefined}
            onChange={(e) => set('name', e.target.value)}
          />
          {nameRefusal && (
            <p id={nameErrorId} role="alert" className="qt-text-xs qt-text-destructive">
              {nameRefusal}
            </p>
          )}
        </div>

        <AtlasAliasInput
          id={`${fieldId}-aliases`}
          label="Aliases"
          aliases={draft.aliases}
          name={draft.name}
          onChange={(aliases) => set('aliases', aliases)}
          disabled={saving}
        />

        <OverlapNotices overlaps={notices} />

        <div className="space-y-1">
          <label className="text-sm qt-text" htmlFor={`${fieldId}-graphic-prompt`}>Graphic prompt</label>
          <p className="qt-text-xs qt-text-secondary">
            What it looks like, in a sentence or two. Handed to the painters as a reference whenever it may be in the
            picture, and to a character who describes it.
          </p>
          <textarea
            id={`${fieldId}-graphic-prompt`}
            rows={3}
            className="qt-textarea w-full"
            value={draft.graphicPrompt}
            placeholder="A 1930s roadster, cream paintwork, chrome running boards, the hood folded down"
            aria-describedby={promptCountId}
            onChange={(e) => set('graphicPrompt', e.target.value)}
          />
          <GraphicPromptCount id={promptCountId} length={draft.graphicPrompt.length} />
        </div>

        <div className="space-y-1">
          <span className="text-sm qt-text block">Knowledge</span>
          <p className="qt-text-xs qt-text-secondary">
            What is known of it. Told to every character who can reach this entry while it is being spoken of.
          </p>
          <MarkdownLexicalEditor
            value={draft.knowledge}
            onChange={(value) => set('knowledge', value)}
            namespace="AtlasEntry.knowledge"
            ariaLabel="Knowledge"
            minHeight="8rem"
            disabled={saving}
          />
        </div>

        <ItemFolderField
          id={`${fieldId}-folder`}
          folders={folders}
          value={draft.folder}
          onChange={(folder) => set('folder', folder)}
          rootLabel="Atlas (top level)"
          placeholder="e.g., Vehicles/Motorcars"
          hint="Where it is filed for your browsing; it never changes who is told of it."
          labelClassName="text-sm qt-text block mb-1"
          inputClassName="qt-input qt-input-sm w-full"
          selectClassName="qt-select qt-select-sm w-full"
        />

        {entry && <ItemPicturesSection spec={ATLAS_PICTURES} container={container} itemId={entry.id} itemTitle={entry.name} />}
      </div>
    </BaseModal>
  )
}

/** An existing entry's pictures: the shared section, with the Atlas's wording. */
const ATLAS_PICTURES: ItemPicturesSpec = {
  kind: 'atlas',
  useImages: useAtlasImages,
  imagesUrl: atlasImagesUrl,
  request: atlasRequest,
  refreshKeys: (entryId) => [queryKeys.atlas.images(entryId), queryKeys.atlas.lists],
  describeError: describeAtlasRefusal,
  generatingLabel: 'Sketching…',
  emptyText: (
    <>
      No pictures yet. A picture is for you — it shows in the browser and in the chip&rsquo;s card, and is never shown to a
      painter. Generate draws from the graphic prompt (or the name, when there is none).
    </>
  ),
  viewLabel: (index, name) => `View picture ${index + 1} of ${name} full screen`,
  uploadLabel: (name) => `Upload a picture of ${name}`,
  headingIdPrefix: 'atlas-pictures',
  noteCurrent: true,
}
