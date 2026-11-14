/**
 * The retired character-page URLs (`/aurora/[id]/view`, `/aurora/[id]/edit`,
 * `/characters/[id]`, `/characters/[id]/view`, `/characters/[id]/edit`) all
 * redirect to `/aurora/[id]`, preserved forever: bookmarks and help links
 * outlive the pages. The old `?tab=` is mapped onto the new `?section=`
 * (`lib/characters/page-sections.ts`) and `?action=` is carried along.
 *
 * Pure (the server routes call `redirect()` with its answer), for tests.
 *
 * @module lib/navigation/legacy-character-redirect
 */

import { characterPageHref, resolveCharacterPageSection } from '@/lib/characters/page-sections'

export function legacyCharacterRedirectTarget(
  characterId: string,
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const pick = (key: string) => (typeof searchParams[key] === 'string' ? (searchParams[key] as string) : undefined)
  const section = resolveCharacterPageSection(pick('section'), pick('tab'))
  return characterPageHref(characterId, { section, action: pick('action') })
}
