'use client'

/**
 * The Inventory object editor — create or edit one object, kit or archetype.
 *
 * Every field of the object: the name and title, the two descriptions (what
 * the characters know about it; how it should be drawn), *Equipped by
 * default*, the per-chat cap, *Can be copied*, the glyph (emoji, or an SVG
 * with a live preview and a size counter), the folder and free-form
 * metadata. A kit edits its members with a picker over what the tier can
 * reach — pictures shown, archetypes allowed, kits excluded. An existing
 * object has a Pictures section (generate, upload, choose, delete).
 *
 * **An instance inherits.** Each inheritable field shows the archetype's
 * value greyed with an *Inherit* toggle; turning it on clears the override
 * (`?action=clear-override`), editing the field sets one.
 *
 * @module components/inventory/inventory-item-editor
 */

import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BaseModal } from '@/components/ui/BaseModal'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { queryKeys } from '@/lib/query/keys'
import {
  INVENTORY_SVG_MAX_BYTES,
  type InventoryInheritableField,
  type ResolvedInventoryItem,
} from '@/lib/schemas/inventory.types'
import { inventorySvgDataUri } from '@/lib/inventory/svg'
import {
  GENERAL_INVENTORY_CONTAINER,
  inventoryImagesUrl,
  type InventoryContainer,
} from '@/lib/inventory/container'
import { inventoryRequest, useInventoryImages, useInventoryList, type InventoryItemBody } from '@/lib/hooks/use-inventory'
import type { InventoryItemActions } from './hooks/useInventoryItemActions'
import { describeInventoryRefusal } from './hooks/useInventoryItemActions'
import { InventoryPicture } from './inventory-glyph'
import { InventoryImageViewer } from './inventory-image-viewer'

interface InventoryItemEditorProps {
  /** The tier a new object is created in; an edited one's own tier. */
  container: InventoryContainer
  containerLabel: string
  /** null to create. */
  item: ResolvedInventoryItem | null
  /** What a create makes. */
  createMode?: 'item' | 'kit' | 'archetype'
  initialFolder?: string
  /** Everything the tier can reach (kit members, an instance's archetype). */
  poolItems: ResolvedInventoryItem[]
  /** The project whose shelf the pool includes, so a kit's members check against it. */
  projectId?: string | null
  actions: InventoryItemActions
  onClose: () => void
  onSaved: () => void
}

type Draft = {
  name: string
  title: string
  description: string
  imageDescription: string
  equippedByDefault: boolean
  maxEquipped: number
  canCopy: boolean
  isArchetype: boolean
  emoji: string
  svg: string
  folder: string
  metadataText: string
  itemIds: string[]
}

const DRAFT_FIELD: Partial<Record<keyof Draft, InventoryInheritableField>> = {
  name: 'name',
  title: 'title',
  description: 'description',
  imageDescription: 'imageDescription',
  equippedByDefault: 'equippedByDefault',
  maxEquipped: 'maxEquipped',
  canCopy: 'canCopy',
  emoji: 'emoji',
  svg: 'svg',
  metadataText: 'metadata',
}

function draftOf(item: ResolvedInventoryItem | null, mode: 'item' | 'kit' | 'archetype', folder: string): Draft {
  return {
    name: item?.name ?? '',
    title: item?.title ?? '',
    description: item?.description ?? '',
    imageDescription: item?.imageDescription ?? '',
    equippedByDefault: item?.equippedByDefault ?? false,
    maxEquipped: item?.maxEquipped ?? 1,
    canCopy: item?.canCopy ?? false,
    isArchetype: item?.isArchetype ?? mode === 'archetype',
    emoji: item?.emoji ?? '',
    svg: item?.svg ?? '',
    folder: item?.folder ?? folder,
    metadataText: item && Object.keys(item.metadata ?? {}).length > 0 ? JSON.stringify(item.metadata, null, 2) : '',
    itemIds: item?.itemIds ?? [],
  }
}

const orNull = (value: string): string | null => (value.trim() ? value.trim() : null)

export function InventoryItemEditor({
  container,
  containerLabel,
  item,
  createMode = 'item',
  initialFolder = '',
  poolItems,
  projectId = null,
  actions,
  onClose,
  onSaved,
}: InventoryItemEditorProps) {
  const isKit = item ? item.kind === 'kit' : createMode === 'kit'
  const isInstance = !!item?.parentId
  const [draft, setDraft] = useState<Draft>(() => draftOf(item, createMode, initialFolder))
  const [inherit, setInherit] = useState<Set<InventoryInheritableField>>(() => {
    if (!item?.parentId) return new Set()
    const overridden = new Set(item.overriddenFields ?? [])
    return new Set(Object.values(DRAFT_FIELD).filter((f): f is InventoryInheritableField => !!f && !overridden.has(f)))
  })
  const [touched, setTouched] = useState<Set<keyof Draft>>(new Set())
  const [saving, setSaving] = useState(false)
  const parent = useMemo(() => (item?.parentId ? poolItems.find((p) => p.id === item.parentId) ?? null : null), [item, poolItems])

  // A project or group kit may also name Quilltap General's objects.
  const generalExtra = useInventoryList(
    isKit && (container.scope === 'project' || container.scope === 'group') ? GENERAL_INVENTORY_CONTAINER : null,
    { includeArchived: false },
  )
  const memberChoices = useMemo(() => {
    const seen = new Set<string>()
    return [...poolItems, ...generalExtra.items].filter((p) => {
      if (p.kind === 'kit' || p.archivedAt || seen.has(p.id)) return false
      seen.add(p.id)
      return true
    })
  }, [poolItems, generalExtra.items])

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setTouched((t) => new Set(t).add(key))
    const field = DRAFT_FIELD[key]
    if (field) setInherit((s) => {
      const next = new Set(s)
      next.delete(field)
      return next
    })
  }
  /**
   * Inherit on: the field follows the archetype (its override is cleared on
   * save). Inherit off: the archetype's value becomes the instance's own
   * override, to be edited from there.
   */
  const toggleInherit = (key: keyof Draft, field: InventoryInheritableField, on: boolean) => {
    setInherit((s) => {
      const next = new Set(s)
      if (on) next.add(field)
      else next.delete(field)
      return next
    })
    if (!on) {
      if (parent) setDraft((d) => ({ ...d, [key]: draftOf(parent, 'item', '')[key] }))
      setTouched((t) => new Set(t).add(key))
    }
  }

  const svgBytes = new TextEncoder().encode(draft.svg).length
  const inherited = (key: keyof Draft): boolean => {
    const field = DRAFT_FIELD[key]
    return isInstance && !!field && inherit.has(field)
  }
  /** What the archetype says, shown greyed for an inherited field. */
  const parentValue = (key: keyof Draft): string => {
    if (!parent) return ''
    const value = (draftOf(parent, 'item', '') as Record<string, unknown>)[key]
    return typeof value === 'string' ? value : String(value ?? '')
  }

  const buildBody = (): InventoryItemBody | null => {
    let metadata: Record<string, unknown> | undefined
    if (draft.metadataText.trim()) {
      try {
        const parsed = JSON.parse(draft.metadataText)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
        metadata = parsed as Record<string, unknown>
      } catch {
        showErrorToast('Metadata must be a JSON object')
        return null
      }
    }
    const full: InventoryItemBody = {
      name: draft.name.trim(),
      title: orNull(draft.title),
      description: orNull(draft.description),
      imageDescription: orNull(draft.imageDescription),
      equippedByDefault: draft.equippedByDefault,
      maxEquipped: Math.max(1, Math.min(999, Math.round(draft.maxEquipped) || 1)),
      canCopy: draft.canCopy,
      emoji: orNull(draft.emoji),
      svg: orNull(draft.svg),
      metadata: metadata ?? {},
      folder: draft.folder,
    }
    if (!item) {
      return { ...full, kind: isKit ? 'kit' : 'item', isArchetype: !isKit && draft.isArchetype, itemIds: isKit ? draft.itemIds : [] }
    }
    if (!isInstance) {
      return { ...full, ...(item.kind !== 'kit' && { isArchetype: draft.isArchetype }), ...(isKit && { itemIds: draft.itemIds }) }
    }
    // An instance sends only the fields it overrides that were edited here.
    const body: InventoryItemBody = { folder: draft.folder }
    for (const [key, field] of Object.entries(DRAFT_FIELD) as Array<[keyof Draft, InventoryInheritableField]>) {
      if (inherit.has(field) || !touched.has(key)) continue
      ;(body as Record<string, unknown>)[field] = (full as Record<string, unknown>)[field]
    }
    return body
  }

  const save = async () => {
    if (!draft.name.trim() && !(isInstance && inherit.has('name'))) {
      showErrorToast('An object needs a name')
      return
    }
    if (svgBytes > INVENTORY_SVG_MAX_BYTES) {
      showErrorToast(`An SVG glyph may be at most ${INVENTORY_SVG_MAX_BYTES / 1024} KB`)
      return
    }
    const body = buildBody()
    if (!body) return
    setSaving(true)
    try {
      if (!item) {
        await actions.mutations.create(container, body, projectId)
        showSuccessToast(`"${draft.title || draft.name}" is laid on the table`)
      } else {
        await actions.mutations.update(container, item.id, body, projectId)
        if (isInstance) {
          const toClear = Array.from(inherit).filter((f) => (item.overriddenFields ?? []).includes(f))
          if (toClear.length > 0) await actions.mutations.clearOverrides(container, item.id, toClear)
        }
        showSuccessToast('Saved')
      }
      onSaved()
    } catch (error) {
      showErrorToast(describeInventoryRefusal(error, 'The object would not be saved'))
    } finally {
      setSaving(false)
    }
  }

  const inheritToggle = (key: keyof Draft) => {
    const field = DRAFT_FIELD[key]
    if (!isInstance || !field) return null
    return (
      <label className="flex items-center gap-1 qt-text-xs qt-text-secondary">
        <input
          type="checkbox"
          className="qt-checkbox"
          checked={inherit.has(field)}
          onChange={(e) => toggleInherit(key, field, e.target.checked)}
          aria-label={`Inherit ${field}`}
        />
        Inherit
      </label>
    )
  }

  const textField = (key: 'name' | 'title' | 'emoji' | 'folder', label: string, placeholder?: string) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-sm text-foreground" htmlFor={`inventory-${key}`}>{label}</label>
        {inheritToggle(key)}
      </div>
      <input
        id={`inventory-${key}`}
        type="text"
        className={`qt-input qt-input-sm w-full ${inherited(key) ? 'opacity-60' : ''}`}
        value={inherited(key) ? parentValue(key) : draft[key]}
        placeholder={placeholder}
        onChange={(e) => set(key, e.target.value)}
      />
    </div>
  )

  const areaField = (key: 'description' | 'imageDescription' | 'metadataText', label: string, hint: string, rows = 3) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-sm text-foreground" htmlFor={`inventory-${key}`}>{label}</label>
        {inheritToggle(key)}
      </div>
      <p className="qt-text-xs qt-text-secondary">{hint}</p>
      <textarea
        id={`inventory-${key}`}
        rows={rows}
        className={`qt-textarea w-full ${inherited(key) ? 'opacity-60' : ''}`}
        value={inherited(key) ? parentValue(key) : draft[key]}
        onChange={(e) => set(key, e.target.value)}
      />
    </div>
  )

  const checkField = (key: 'equippedByDefault' | 'canCopy' | 'isArchetype', label: string, hint: string) => (
    <div className="flex items-start justify-between gap-2">
      <label className="flex items-start gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          className="qt-checkbox mt-0.5"
          checked={inherited(key) && parent ? Boolean(parent[key]) : draft[key]}
          onChange={(e) => set(key, e.target.checked)}
        />
        <span>
          {label}
          <span className="block qt-text-xs qt-text-secondary">{hint}</span>
        </span>
      </label>
      {inheritToggle(key)}
    </div>
  )

  const title = item
    ? `Edit ${item.title || item.name}`
    : isKit ? 'New kit' : draft.isArchetype ? 'New archetype' : 'New object'

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title={title}
      maxWidth="2xl"
      overlayClassName="z-[70]"
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
          {item ? 'Kept in' : 'Will be kept in'} {containerLabel}
          {isInstance && parent && <> · an instance of <strong>{parent.title || parent.name}</strong></>}
          {isInstance && !parent && ' · an instance whose archetype is out of view'}
        </p>
        <div className="grid md:grid-cols-2 gap-3">
          {textField('name', 'Name', isKit ? "burglar's kit" : 'sword')}
          {textField('title', 'Title', isKit ? 'The Night Shift' : 'Excalibur')}
        </div>
        {areaField('description', 'What the characters know about it', 'Told to the model while the object is carried. Leave empty and the object is silent to the model.')}
        {areaField('imageDescription', 'How it should be drawn', 'Rendering hints joined to the character\'s appearance while carried, and the subject of the object\'s own picture.', 2)}
        {isKit && (
          <fieldset className="space-y-1">
            <legend className="text-sm text-foreground">Members</legend>
            <p className="qt-text-xs qt-text-secondary">
              Equipping the kit takes up every member; an archetype member is made into an instance for the character who equips it.
            </p>
            <ul className="max-h-56 overflow-y-auto space-y-1" aria-label="Kit members">
              {memberChoices.map((choice) => {
                const checked = draft.itemIds.includes(choice.id)
                return (
                  <li key={choice.id}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="qt-checkbox"
                        checked={checked}
                        onChange={() =>
                          set('itemIds', checked ? draft.itemIds.filter((id) => id !== choice.id) : [...draft.itemIds, choice.id])
                        }
                      />
                      <InventoryPicture item={choice} size={32} />
                      <span className="flex-1 min-w-0 truncate">{choice.title || choice.name}</span>
                      {choice.isArchetype && <span className="qt-badge qt-badge-primary">Archetype</span>}
                    </label>
                  </li>
                )
              })}
              {memberChoices.length === 0 && <li className="qt-text-xs qt-text-secondary">Nothing here to put in a kit yet.</li>}
            </ul>
          </fieldset>
        )}
        {!isKit && (
          <div className="space-y-2">
            {checkField('equippedByDefault', 'Equipped by default', 'Every character who can reach it arrives in a new chat carrying it.')}
            {checkField('canCopy', 'Can be copied', 'Off refuses Duplicate and copy-transfers; moving and instantiating stay allowed.')}
            {!isInstance && checkField('isArchetype', 'Archetype', 'A class of object, never carried itself; characters get instances of it.')}
            <div className="flex items-center gap-2">
              <label className="text-sm text-foreground" htmlFor="inventory-maxEquipped">Carried at most</label>
              <input
                id="inventory-maxEquipped"
                type="number"
                min={1}
                max={999}
                className={`qt-input qt-input-sm w-20 ${inherited('maxEquipped') ? 'opacity-60' : ''}`}
                value={inherited('maxEquipped') && parent ? parent.maxEquipped : draft.maxEquipped}
                onChange={(e) => set('maxEquipped', Number(e.target.value))}
              />
              <span className="qt-text-xs qt-text-secondary">at a time, per chat, across objects of the same name</span>
              {inheritToggle('maxEquipped')}
            </div>
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-3">
          {textField('emoji', 'Emoji glyph', isKit ? '🎒' : '🗡️')}
          {textField('folder', 'Folder', isKit ? 'Loadouts' : 'Weapons/Edged')}
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-sm text-foreground" htmlFor="inventory-svg">SVG glyph</label>
            {inheritToggle('svg')}
          </div>
          <div className="flex items-start gap-3">
            <textarea
              id="inventory-svg"
              rows={3}
              className={`qt-textarea flex-1 font-mono text-xs ${inherited('svg') ? 'opacity-60' : ''}`}
              value={inherited('svg') ? parentValue('svg') : draft.svg}
              placeholder="<svg viewBox='0 0 24 24'>…</svg>"
              onChange={(e) => set('svg', e.target.value)}
            />
            <div className="flex flex-col items-center gap-1">
              <span className="inline-flex items-center justify-center w-12 h-12 rounded border qt-border-default qt-bg-muted">
                {(inherited('svg') ? parentValue('svg') : draft.svg).trim().startsWith('<svg') && (
                  <img src={inventorySvgDataUri(inherited('svg') ? parentValue('svg') : draft.svg)} alt="" className="w-10 h-10 object-contain" />
                )}
              </span>
              <span className={`qt-text-xs ${svgBytes > INVENTORY_SVG_MAX_BYTES ? 'qt-text-destructive' : 'qt-text-secondary'}`}>
                {(svgBytes / 1024).toFixed(1)} / {INVENTORY_SVG_MAX_BYTES / 1024} KB
              </span>
            </div>
          </div>
        </div>
        {areaField('metadataText', 'Metadata', 'Free-form JSON object for anything else (weight, value, charges…).', 3)}
        {item && <InventoryPicturesSection container={container} item={item} />}
      </div>
    </BaseModal>
  )
}

/** An existing object's pictures: generate, upload, choose, delete. */
function InventoryPicturesSection({ container, item }: { container: InventoryContainer; item: ResolvedInventoryItem }) {
  const queryClient = useQueryClient()
  const { images, current, loading } = useInventoryImages(container, item.id)
  const [busy, setBusy] = useState<string | null>(null)
  const [viewing, setViewing] = useState<number | null>(null)
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory.images(item.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory.lists }),
    ])
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label)
    try {
      await fn()
      await refresh()
    } catch (error) {
      showErrorToast(describeInventoryRefusal(error, 'The picture would not oblige'))
    } finally {
      setBusy(null)
    }
  }
  const upload = (file: File) =>
    run('upload', async () => {
      const form = new FormData()
      form.set('file', file)
      const res = await fetch(inventoryImagesUrl(container, item.id, 'upload'), { method: 'POST', body: form })
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Upload failed')
    })
  const inherited = images.some((image) => image.inherited)

  return (
    <section className="space-y-2 border-t qt-border-default pt-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm text-foreground">Pictures</h3>
        <div className="flex items-center gap-2">
          <label className="qt-button-ghost qt-button-sm cursor-pointer">
            Upload…
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
          </label>
          <button
            type="button"
            className="qt-button-secondary qt-button-sm"
            disabled={busy !== null}
            onClick={() => void run('generate', () => inventoryRequest(inventoryImagesUrl(container, item.id, 'generate'), 'POST', {}))}
          >
            {busy === 'generate' ? 'Drawing…' : 'Generate'}
          </button>
        </div>
      </div>
      {inherited && <p className="qt-text-xs qt-text-secondary">Showing the archetype&apos;s pictures; upload or generate one to give this object its own.</p>}
      {loading ? (
        <div className="qt-text-xs qt-text-secondary">Loading pictures…</div>
      ) : images.length === 0 ? (
        <div className="qt-text-xs qt-text-secondary">No pictures yet. A picture is for choosing the object in pickers; rows show its glyph.</div>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {images.map((image, index) => (
            <li key={image.fileId} className="flex flex-col items-center gap-1">
              <button type="button" onClick={() => setViewing(index)} aria-label="View picture full screen">
                <img
                  src={image.thumbnailUrl}
                  alt=""
                  className={`w-20 h-20 rounded object-cover border ${image.fileId === current ? 'qt-border-primary' : 'qt-border-default'}`}
                />
              </button>
              {!image.inherited && (
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="qt-button-ghost qt-button-sm"
                    disabled={image.fileId === current || busy !== null}
                    onClick={() => void run('current', () => inventoryRequest(inventoryImagesUrl(container, item.id, 'set-current'), 'POST', { fileId: image.fileId }))}
                  >
                    {image.fileId === current ? 'Current' : 'Use'}
                  </button>
                  <button
                    type="button"
                    className="qt-button-ghost qt-button-sm qt-text-destructive"
                    disabled={busy !== null}
                    onClick={() => void run('delete', () => inventoryRequest(inventoryImagesUrl(container, item.id, 'delete-image'), 'POST', { fileId: image.fileId }))}
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {viewing !== null && images[viewing] && (
        <InventoryImageViewer
          onClose={() => setViewing(null)}
          itemId={item.id}
          itemTitle={item.title || item.name}
          container={container}
          fileId={images[viewing].fileId}
          onPrev={images.length > 1 ? () => setViewing((viewing - 1 + images.length) % images.length) : undefined}
          onNext={images.length > 1 ? () => setViewing((viewing + 1) % images.length) : undefined}
        />
      )}
    </section>
  )
}
