/**
 * The safety nets a candidate row passes before it is embedded and decided.
 *
 *  - **Name presence.** An extracted (AUTO) row that claims to be about
 *    someone other than its holder, when that someone is never named in the
 *    text, was almost certainly mis-attributed by the model: the claim
 *    collapses to the holder. Hand-written rows keep their stated subject.
 *  - **Episodic fallback anchors.** When the extractor left out `entities` or
 *    `occurredAt`, the deterministic date and proper-noun regexes recover them
 *    from the text (a date phrase resolves against the source message's time on
 *    the instance calendar). Fills gaps only; hand-written rows pass untouched.
 *
 * Reads only (characters), so it runs in whichever process admits — the job
 * child included — before the embedding is made.
 *
 * @module memory/admission/prepare
 */

import { getRepositories } from '@/lib/repositories/factory'
import { logger } from '@/lib/logger'
import { resolveAboutCharacterId } from '../about-character-resolution'
import { resolveWhenPhrase } from '../time/clock'
import { extractNovelDetails } from './novel-details'
import type { AdmissionRow } from './types'

/** Cap on regex-derived fallback entities so noise can't flood the column. */
const FALLBACK_ANCHOR_MAX_ENTITIES = 6

/** Collapse a mis-attributed AUTO subject to the holder. Never throws. */
export async function applyNamePresenceCheck(row: AdmissionRow, notes: string[] = []): Promise<AdmissionRow> {
  const proposed = row.aboutCharacterId
  if (!proposed || proposed === row.characterId) return row
  // Only second-guess AUTO-extracted attributions; MANUAL memories carry the
  // user's deliberate choice of about-target.
  if (row.source && row.source !== 'AUTO') return row
  try {
    const repos = getRepositories()
    const [aboutChar, holderChar] = await Promise.all([
      repos.characters.findById(proposed),
      repos.characters.findById(row.characterId),
    ])
    const resolution = resolveAboutCharacterId({
      holderCharacterId: row.characterId,
      holderCharacter: holderChar ? { name: holderChar.name, aliases: holderChar.aliases } : null,
      proposedAboutCharacterId: proposed,
      proposedAboutCharacter: aboutChar
        ? { name: aboutChar.name, aliases: aboutChar.aliases, controlledBy: aboutChar.controlledBy }
        : null,
      text: `${row.summary || ''}\n${row.content || ''}`,
    })
    if (resolution.flipped) {
      notes.push(`subject ${proposed} not named in the text; recorded as a self memory`)
      logger.debug('[Admission] Name-presence check collapsed the subject to the holder', {
        holderCharacterId: row.characterId,
        proposedAboutCharacterId: proposed,
      })
      return { ...row, aboutCharacterId: row.characterId }
    }
    return row
  } catch (error) {
    // Never block a memory write on the safety-net lookup.
    logger.warn('[Admission] Name-presence check failed; using proposed aboutCharacterId unchanged', {
      holderCharacterId: row.characterId,
      proposedAboutCharacterId: proposed,
      error: error instanceof Error ? error.message : String(error),
    })
    return row
  }
}

/** Fill a missing `entities` / `occurredAt` on an AUTO row from its text. Never throws. */
export function applyEpisodicFallbackAnchors(row: AdmissionRow, timeZone: string): AdmissionRow {
  if (row.source && row.source !== 'AUTO') return row
  const needEntities = !row.entities || row.entities.length === 0
  const needOccurredAt = !row.occurredAt
  if (!needEntities && !needOccurredAt) return row

  try {
    const details = extractNovelDetails(row.content || '', '')
    const next = { ...row }

    if (needOccurredAt) {
      const anchorIso = row.sourceMessageTimestamp ?? new Date().toISOString()
      for (const detail of details) {
        const resolved = resolveWhenPhrase(detail, anchorIso, timeZone)
        if (resolved) {
          next.occurredAt = resolved
          break
        }
      }
    }

    if (needEntities) {
      // Proper-noun-shaped details only (skip the date/number/measure captures).
      const entities = details
        .filter(d => /^[A-Z]/.test(d) && !/\d/.test(d))
        .slice(0, FALLBACK_ANCHOR_MAX_ENTITIES)
      if (entities.length > 0) next.entities = entities
    }

    return next
  } catch {
    // Deterministic fallback must never block a write.
    return row
  }
}
