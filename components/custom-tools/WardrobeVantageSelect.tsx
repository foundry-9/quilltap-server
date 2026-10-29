'use client'

/**
 * WardrobeVantageSelect — whose wardrobe (or inventory) the Workbench is
 * looking at; `browsing` picks the words, the vantage is the same.
 *
 * A tool has no character until it is run, so the Workbench browses garments
 * from a vantage: a character whose reach to show, or one shared wardrobe.
 * One compact `<select>` (characters, then shared wardrobes) over the
 * destinations payload the editor already holds, plus one muted line saying
 * what the vantage means for a file any character may one day roll. Rendered
 * at the head of the Side effects card and in the picker dialog's header.
 *
 * The vantage is editor state only; nothing here reaches the file.
 *
 * Design of record: docs/developer/features/complete/pascal-wardrobe-effect-picker.md §1.3
 */

import type { CustomToolDestinations } from '@/lib/pascal/workbench'
import type { WardrobeVantage } from '@/lib/pascal/tool-draft'
import {
  GENERAL_CONTAINER,
  GENERAL_WARDROBE_NAME,
  decodeWardrobeContainer,
  encodeWardrobeContainer,
  wardrobeReachLabel,
  type WardrobeOrigin,
} from '@/lib/wardrobe/wardrobe-container'

const NONE_VALUE = 'none'

/** A vantage as a `<select>` value: `none`, `char:<id>`, or an encoded container. */
export function encodeWardrobeVantage(vantage: WardrobeVantage): string {
  if (vantage.kind === 'character') return `char:${vantage.characterId}`
  if (vantage.kind === 'container') return encodeWardrobeContainer(vantage.container)
  return NONE_VALUE
}

/** Parse a `<select>` value back into a vantage; anything mangled reads as `none`. */
export function decodeWardrobeVantage(value: string): WardrobeVantage {
  if (value.startsWith('char:')) {
    const characterId = value.slice('char:'.length)
    return characterId ? { kind: 'character', characterId } : { kind: 'none' }
  }
  const container = value === NONE_VALUE ? null : decodeWardrobeContainer(value)
  return container ? { kind: 'container', container } : { kind: 'none' }
}

/**
 * The vantage as an origin — the character's or the store's name — so reach
 * and origin labels are spelled by the same functions the wardrobe dialog
 * uses. Null for `none`, or for an id the destinations no longer list.
 */
export function wardrobeVantageOrigin(
  vantage: WardrobeVantage,
  destinations: CustomToolDestinations | undefined,
): WardrobeOrigin | null {
  if (vantage.kind === 'none') return null
  if (vantage.kind === 'character') {
    const character = destinations?.characters.find((c) => c.characterId === vantage.characterId)
    return { scope: 'character', id: vantage.characterId, name: character?.characterName ?? '' }
  }
  const { container } = vantage
  switch (container.scope) {
    case 'general':
      return { scope: 'general', id: null, name: GENERAL_WARDROBE_NAME }
    case 'project': {
      const project = destinations?.projects.find((p) => p.projectId === container.id)
      return { scope: 'project', id: container.id, name: project?.projectName ?? 'this project' }
    }
    case 'group': {
      const group = destinations?.groups.find((g) => g.groupId === container.id)
      return { scope: 'group', id: container.id, name: group?.groupName ?? 'this group' }
    }
    case 'character':
      return { scope: 'character', id: container.id, name: '' }
  }
}

/** The vantage's display name: "Imogen", "Quilltap General", "Thornfield"… */
export function wardrobeVantageName(
  vantage: WardrobeVantage,
  destinations: CustomToolDestinations | undefined,
): string | null {
  const origin = wardrobeVantageOrigin(vantage, destinations)
  if (!origin) return null
  return origin.name || (origin.scope === 'character' ? 'this character' : null)
}

/** What the vantage is browsed for: garments, objects, or both (a tool with both kinds of effect). */
export type VantageBrowsing = 'wardrobe' | 'inventory' | 'both'

/** The nouns each kind of browsing is spoken of in. */
const BROWSING_WORDS: Record<VantageBrowsing, { store: string; stores: string; things: string; shared: string }> = {
  wardrobe: { store: 'wardrobe', stores: 'wardrobes', things: 'garments', shared: 'Shared wardrobes' },
  inventory: { store: 'inventory', stores: 'inventories', things: 'objects', shared: 'Shared inventories' },
  both: { store: 'wardrobe and inventory', stores: 'wardrobes and inventories', things: 'garments and objects', shared: 'Shared stores' },
}

interface WardrobeVantageSelectProps {
  vantage: WardrobeVantage
  onChange: (next: WardrobeVantage) => void
  destinations: CustomToolDestinations | undefined
  /**
   * The project whose store the file lives in, when it does. Named under a
   * character vantage: the lens leaves the project tier out (the Workbench has
   * no chat), but a run there will reach it.
   */
  homeProjectName?: string | null
  /** Show the explanatory line beneath the select. Default true. */
  showHint?: boolean
  /** What is being browsed, for the wording. Default `'wardrobe'`. */
  browsing?: VantageBrowsing
  disabled?: boolean
}

export function WardrobeVantageSelect({
  vantage,
  onChange,
  destinations,
  homeProjectName = null,
  showHint = true,
  browsing = 'wardrobe',
  disabled = false,
}: Readonly<WardrobeVantageSelectProps>) {
  const words = BROWSING_WORDS[browsing]
  const name = wardrobeVantageName(vantage, destinations)
  const origin = wardrobeVantageOrigin(vantage, destinations)

  return (
    <div className="space-y-1 text-sm">
      <label className="flex items-center gap-2 flex-wrap">
        <span>
          Browsing{' '}
          {vantage.kind === 'character' && name ? (
            <strong>{name}&rsquo;s</strong>
          ) : vantage.kind === 'container' && name ? (
            <strong>{name}</strong>
          ) : null}{' '}
          {words.store}
        </span>
        <select
          value={encodeWardrobeVantage(vantage)}
          onChange={(e) => onChange(decodeWardrobeVantage(e.target.value))}
          disabled={disabled}
          className="qt-select qt-select-sm"
          aria-label={`Whose ${words.store} to browse`}
        >
          <option value={NONE_VALUE}>— choose —</option>
          {(destinations?.characters.length ?? 0) > 0 && (
            <optgroup label="Characters">
              {destinations!.characters.map((c) => (
                <option key={c.characterId} value={`char:${c.characterId}`}>
                  {c.characterName}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label={words.shared}>
            <option value={encodeWardrobeContainer(GENERAL_CONTAINER)}>{GENERAL_WARDROBE_NAME}</option>
            {destinations?.projects.map((p) => (
              <option key={p.projectId} value={encodeWardrobeContainer({ scope: 'project', id: p.projectId })}>
                Project · {p.projectName}
              </option>
            ))}
            {destinations?.groups.map((g) => (
              <option key={g.groupId} value={encodeWardrobeContainer({ scope: 'group', id: g.groupId })}>
                Group · {g.groupName}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      {showHint && (
        <p className="text-xs qt-text-secondary">
          {vantage.kind === 'character' ? (
            <>
              What {name} can reach: {name}&rsquo;s own {words.store}, the {words.stores} of {name}&rsquo;s groups, and{' '}
              {GENERAL_WARDROBE_NAME}. Another character rolling this tool sees their own.
              {homeProjectName && (
                <>
                  {' '}
                  This tool lives in {homeProjectName}&rsquo;s store; {words.things} from {homeProjectName}&rsquo;s
                  {words.store} will also be in reach when it runs there.
                </>
              )}
            </>
          ) : vantage.kind === 'container' ? (
            <>Every one of the {words.things} here, and who can reach them: {wardrobeReachLabel(origin)}.</>
          ) : (
            <>Choose whose {words.store} to browse before picking {words.things}.</>
          )}
        </p>
      )}
    </div>
  )
}

export default WardrobeVantageSelect
