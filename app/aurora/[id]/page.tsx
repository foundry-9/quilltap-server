/**
 * The one character page, `/aurora/[id]` — redirects into the tabbed workspace
 * as a `character` tab, carrying `?section=` (or a retired page's `?tab=`,
 * mapped) and `?action=chat`. Design of record:
 * `docs/developer/features/complete/aurora-character-page-unification.md`.
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'
import { resolveCharacterPageSection } from '@/lib/characters/page-sections'

export default async function CharacterPageRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const pick = (key: string) => (typeof sp[key] === 'string' ? (sp[key] as string) : undefined)
  const section = resolveCharacterPageSection(pick('section'), pick('tab'))
  const action = pick('action')
  return redirectToWorkspaceTab('character', { characterId: id, section, action })
}
