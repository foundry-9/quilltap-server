/**
 * The sections of the one character page (`/aurora/[id]`), and the mapping
 * from the retired view/edit pages' `?tab=` values onto them.
 *
 * Pure and client-safe: the route redirects, the workspace's route-to-intent
 * and layout migration, and the page itself all read the same table, so an
 * old bookmark, a persisted workspace tab and a help link land in the same
 * place. Design of record:
 * `docs/developer/features/complete/aurora-character-page-unification.md` §5.
 *
 * @module lib/characters/page-sections
 */

export const CHARACTER_PAGE_SECTIONS = [
  'details',
  'prompts',
  'appearance',
  'abilities',
  'chat-defaults',
  'history',
] as const

export type CharacterPageSection = (typeof CHARACTER_PAGE_SECTIONS)[number]

export const DEFAULT_CHARACTER_PAGE_SECTION: CharacterPageSection = 'details'

/**
 * The retired pages' `?tab=` ids → the section that now holds what they held.
 * Preserved forever: bookmarks and help links outlive the pages.
 */
const LEGACY_TAB_TO_SECTION: Readonly<Record<string, CharacterPageSection>> = {
  details: 'details',
  tags: 'details',
  'system-prompts': 'prompts',
  conversations: 'history',
  memories: 'history',
  rename: 'history',
  wardrobe: 'appearance',
  gallery: 'appearance',
  descriptions: 'appearance',
  defaults: 'chat-defaults',
}

export function isCharacterPageSection(value: unknown): value is CharacterPageSection {
  return typeof value === 'string' && (CHARACTER_PAGE_SECTIONS as readonly string[]).includes(value)
}

/**
 * The section a deep link names. A current `?section=` wins; otherwise a
 * legacy `?tab=` is mapped; anything unknown is `undefined` (the page then
 * opens on its default section).
 */
export function resolveCharacterPageSection(
  section?: string | null,
  legacyTab?: string | null,
): CharacterPageSection | undefined {
  if (isCharacterPageSection(section)) return section
  if (legacyTab) {
    if (isCharacterPageSection(legacyTab)) return legacyTab
    return LEGACY_TAB_TO_SECTION[legacyTab]
  }
  return undefined
}

/** `/aurora/<id>` with an optional section and action, as a URL. */
export function characterPageHref(
  characterId: string,
  opts: { section?: CharacterPageSection; action?: string } = {},
): string {
  const params = new URLSearchParams()
  if (opts.section && opts.section !== DEFAULT_CHARACTER_PAGE_SECTION) params.set('section', opts.section)
  if (opts.action) params.set('action', opts.action)
  const qs = params.toString()
  return qs ? `/aurora/${characterId}?${qs}` : `/aurora/${characterId}`
}
