/**
 * Character references for the research kit and the Brahma lookups: one
 * resolver from a name, alias or id to one character.
 *
 * @module lib/research/characters
 */

import { getRepositories } from '@/lib/repositories/factory'
import type { Character } from '@/lib/schemas/types'

export type CharacterMatch =
  | { kind: 'found'; character: Character }
  | { kind: 'none' }
  | { kind: 'ambiguous'; candidates: Array<{ id: string; name: string }> }

/**
 * Resolve a name, alias or id to one character. Exact id / name matches come
 * from the unhydrated rows (`findAllRaw` — aliases are not needed to match a
 * name, and hydrating every vault to resolve one would be wasted work); only
 * when that misses are the hydrated rows (`findAll`) consulted for aliases and
 * partial names. The winner is always returned hydrated via `findById`.
 */
export async function resolveCharacterRef(ref: string): Promise<CharacterMatch> {
  const repos = getRepositories()
  const needle = ref.trim().toLowerCase()
  if (!needle) return { kind: 'none' }

  const hydrate = async (id: string): Promise<CharacterMatch> => {
    const character = await repos.characters.findById(id)
    return character ? { kind: 'found', character } : { kind: 'none' }
  }

  const raw = await repos.characters.findAllRaw()
  const byId = raw.find(c => c.id.toLowerCase() === needle)
  if (byId) return hydrate(byId.id)
  const byName = raw.filter(c => c.name.trim().toLowerCase() === needle)
  if (byName.length === 1) return hydrate(byName[0].id)

  // Aliases live in the vault, so the alias match needs hydrated characters
  // (a raw row has none — it used to be matched against nothing here).
  const all = byName.length > 1
    ? await repos.characters.findByIds(byName.map(c => c.id))
    : await repos.characters.findAll()
  const exact = all.filter(c =>
    c.name.trim().toLowerCase() === needle ||
    (c.aliases ?? []).some(a => a.trim().toLowerCase() === needle)
  )
  const pool = exact.length > 0
    ? exact
    : all.filter(c =>
        c.name.toLowerCase().includes(needle) ||
        (c.aliases ?? []).some(a => a.toLowerCase().includes(needle))
      )
  // Prefer a live character over an archived namesake.
  const live = pool.filter(c => !c.archivedAt)
  const chosen = live.length > 0 ? live : pool
  if (chosen.length === 1) return hydrate(chosen[0].id)
  if (chosen.length === 0) return { kind: 'none' }
  return { kind: 'ambiguous', candidates: chosen.slice(0, 10).map(c => ({ id: c.id, name: c.name })) }
}

