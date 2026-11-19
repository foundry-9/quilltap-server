/**
 * Import from Instructions — the brief: what the instance already knows about
 * the wardrobe a design is for, assembled by the server and placed in the
 * user message whatever tools the run has.
 *
 * It reads only. Nothing is provisioned (`ensure` is never passed), an
 * archived character is refused before this is called, and every part fails
 * soft on its own: a part that cannot be read is logged and left out, and the
 * design goes ahead on the rest.
 *
 * The target's own pieces are numbered, and the model names them by number,
 * so a small model never handles a UUID (the prompt optimizer's rule).
 * `reusable[n - 1]` is piece `n`.
 *
 * Server-only.
 *
 * @module wardrobe/instruction-design/brief
 */

import { logger } from '@/lib/logger'
import { genderNounFromPronouns } from '@/lib/characters/pronoun-gender'
import { isHumanoid, pickPhysicalDescription } from '@/lib/characters/physical-description'
import type { RepositoryContainer } from '@/lib/repositories/factory'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'
import type { WardrobeLocation } from '@/lib/wardrobe/location'
import { loadWearablePool } from '@/lib/wardrobe/pool'
import { GENERAL_WARDROBE_NAME } from '@/lib/wardrobe/wardrobe-container'
import { readWardrobeInstructionsFile, resolveWardrobeInstructions } from '@/lib/wardrobe/wardrobe-instructions'

const moduleLogger = logger.child({ module: 'wardrobe-design-brief' })

/** The most own pieces listed (and so reusable). */
export const BRIEF_MAX_OWN_PIECES = 150
/** The most pieces listed from other tiers. */
export const BRIEF_MAX_SHARED_PIECES = 100
/** The most existing outfit titles listed. */
export const BRIEF_MAX_OUTFIT_TITLES = 100
/** Caps on the prose a character contributes. */
const PHYSICAL_MAX = 1200
const PERSON_MAX = 1500
const DRESSING_INSTRUCTIONS_MAX = 2000

export interface WardrobeDesignBrief {
  /** The brief as the model reads it. */
  text: string
  /** The numbered pieces, in list order: `reusable[n - 1]` is piece `n`. */
  reusable: WardrobeItem[]
  /** Which parts made it in, for the log. */
  parts: string[]
}

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text)

const isComposite = (item: Pick<WardrobeItem, 'componentItemIds'>): boolean => (item.componentItemIds?.length ?? 0) > 0

const byNewest = (a: WardrobeItem, b: WardrobeItem): number =>
  String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))

const pieceLine = (item: Pick<WardrobeItem, 'title' | 'types' | 'imagePrompt'>): string =>
  `${item.title} [${item.types.join(', ')}]${item.imagePrompt?.trim() ? ` — ${item.imagePrompt.trim()}` : ''}`

/** One part of the brief; a throw costs that part alone. */
async function part(name: string, build: () => Promise<string | null>, parts: string[]): Promise<string | null> {
  try {
    const text = await build()
    if (text) parts.push(name)
    return text
  } catch (error) {
    moduleLogger.warn('[Wardrobe Design] A part of the brief could not be read and is left out', {
      part: name,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** The tier in words, as the model is told it. */
export function describeWardrobeTarget(location: Pick<WardrobeLocation, 'scope' | 'origin'>): string {
  const name = location.origin.name?.trim()
  switch (location.scope) {
    case 'character':
      return name ? `the character ${name}'s own wardrobe` : "a character's own wardrobe"
    case 'group':
      return name ? `the wardrobe of the group "${name}"` : "a group's wardrobe"
    case 'project':
      return name ? `the wardrobe of the project "${name}"` : "a project's wardrobe"
    case 'general':
      return `${GENERAL_WARDROBE_NAME} (reachable by every character)`
  }
}

function whoMayWear(location: Pick<WardrobeLocation, 'scope' | 'origin'>): string | null {
  switch (location.scope) {
    case 'group':
      return 'Any member of this group may wear these pieces. Design for no one character in particular unless the instructions name one.'
    case 'project':
      return "Any character in this project's chats may wear these pieces. Design for no one character in particular unless the instructions name one."
    case 'general':
      return 'Any character may wear these pieces. Design for no one character in particular unless the instructions name one.'
    case 'character':
      return null
  }
}

/**
 * Assemble the brief for a resolved target. Never throws.
 *
 * @param location the target wardrobe, already resolved (and, for a
 *   character, already checked against the archive tombstone)
 */
export async function buildWardrobeDesignBrief(
  repos: RepositoryContainer,
  location: WardrobeLocation,
): Promise<WardrobeDesignBrief> {
  const parts: string[] = []
  const sections: string[] = [`Filed in: ${describeWardrobeTarget(location)}`]
  const characterId = location.scope === 'character' ? location.origin.id : null

  // The wearer — a character's own wardrobe only.
  if (characterId) {
    const wearer = await part(
      'wearer',
      async () => {
        const character = await repos.characters.findById(characterId)
        if (!character) return null
        const lines = [`Name: ${character.name}`]
        const pronouns = character.pronouns
        if (pronouns) {
          const noun = isHumanoid(character.physicalDescription) ? genderNounFromPronouns(pronouns) : null
          lines.push(
            `Pronouns: ${pronouns.subject}/${pronouns.object}/${pronouns.possessive}${noun ? ` (a ${noun})` : ''}`,
          )
        }
        if (!isHumanoid(character.physicalDescription)) {
          lines.push('Not humanoid: design for the form described, not for a human body.')
        }
        const looks = pickPhysicalDescription(character.physicalDescription, 'full-length')
        if (looks) lines.push(`Looks: ${clip(looks, PHYSICAL_MAX)}`)
        const person = [character.identity, character.description]
          .map((t) => t?.trim())
          .filter(Boolean)
          .join('\n')
        if (person) lines.push(`Who they are:\n${clip(person, PERSON_MAX)}`)
        return `## The wearer\n${lines.join('\n')}`
      },
      parts,
    )
    if (wearer) sections.push(wearer)
  } else {
    const who = whoMayWear(location)
    if (who) sections.push(`## Who may wear it\n${who}`)
  }

  // What the wearer can already reach from other tiers, and the mounts their
  // dressing instructions cascade through — one pool read serves both.
  let pool: Awaited<ReturnType<typeof loadWearablePool>> | null = null
  if (characterId) {
    try {
      // No chat, so no project tier: the character's own pieces and their groups'.
      pool = await loadWearablePool(repos, characterId, [])
    } catch (error) {
      moduleLogger.warn("[Wardrobe Design] The wearer's wider wardrobe could not be read", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const dressing = await part(
    'dressing-instructions',
    async () => {
      const content = characterId
        ? (
            await resolveWardrobeInstructions({
              characterMountPointId: location.mountPointId,
              groupMountPointIds: pool?.tiers.groupMountPointIds ?? [],
              projectMountPointIds: [],
            })
          )?.content
        : await readWardrobeInstructionsFile(location.mountPointId)
      if (!content) return null
      return (
        '## Dressing instructions\n' +
        "The wearer's standing preferences, as the operator wrote them. Honour them unless the operator's instructions for this design say otherwise.\n\n" +
        clip(content, DRESSING_INSTRUCTIONS_MAX)
      )
    },
    parts,
  )
  if (dressing) sections.push(dressing)

  // This rail: the target's own live pieces, numbered and reusable; its outfits by title.
  let reusable: WardrobeItem[] = []
  let outfitTitles: string[] = []
  const rail = await part(
    'rail',
    async () => {
      const live = (await location.readItems(false)).filter((item) => !item.archivedAt)
      const leaves = live.filter((item) => !isComposite(item)).sort(byNewest)
      outfitTitles = live.filter(isComposite).sort(byNewest).map((item) => item.title)
      reusable = leaves.slice(0, BRIEF_MAX_OWN_PIECES)
      if (reusable.length === 0) return null
      const more = leaves.length - reusable.length
      return (
        '## Already on this rail\n' +
        'Pieces already in this wardrobe. Do not design a duplicate of one. Where one belongs in the outfit, name it by its number in `outfit.reuse`.\n\n' +
        reusable.map((item, i) => `${i + 1}. ${pieceLine(item)}`).join('\n') +
        (more > 0 ? `\n…and ${more} more, not listed.` : '')
      )
    },
    parts,
  )
  if (rail) sections.push(rail)

  if (pool) {
    const elsewhere = await part(
      'elsewhere',
      async () => {
        const shared = pool
          .wearable()
          .filter((item) => !pool.owns(item) && !isComposite(item))
          .slice(0, BRIEF_MAX_SHARED_PIECES)
        if (shared.length === 0) return null
        return (
          '## Already available from elsewhere\n' +
          'Shared pieces this character can already wear. Do not design a duplicate of one. They cannot be named in `outfit.reuse`.\n\n' +
          shared.map((item) => `- ${pieceLine(item)}`).join('\n')
        )
      },
      parts,
    )
    if (elsewhere) sections.push(elsewhere)
  }

  if (outfitTitles.length > 0) {
    parts.push('outfit-titles')
    sections.push(
      '## Outfit titles already taken here\n' +
        outfitTitles.slice(0, BRIEF_MAX_OUTFIT_TITLES).join('; '),
    )
  }

  moduleLogger.debug('[Wardrobe Design] Brief assembled', {
    scope: location.scope,
    parts,
    reusable: reusable.length,
    length: sections.join('\n\n').length,
  })
  return { text: sections.join('\n\n'), reusable, parts }
}
