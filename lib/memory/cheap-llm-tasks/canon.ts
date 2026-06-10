/**
 * Canon block loader for memory extraction prompts.
 *
 * The "canon block" is the ALREADY ESTABLISHED section injected into a memory
 * extraction system prompt so the extractor can skip facts that are already on
 * file about the subject.
 *
 * Two resolution paths:
 *
 *   - SELF pass (a character extracting memories about themselves): canon comes
 *     from the character's own vantage-point fields, rendered manifesto-first
 *     so the axiomatic core reads as the floor: `manifesto`, `personality`,
 *     `description`, `identity`. No vault lookup, since looking in
 *     `Others/<self>.md` for self-knowledge would be incoherent and would
 *     shadow the actual identity fields.
 *
 *   - OTHER pass (a character extracting memories about another participant,
 *     including the user): canon comes from the observer's vault at
 *     `Others/<sanitized-subject-name>.md`, falling back to the subject's
 *     `identity` property, and to `description` only when `identity` is empty.
 *     Never `personality` or `manifesto` — no observer sees another
 *     character's interior or axiomatic core.
 */

import { readVaultTextFile } from '@/lib/database/repositories/character-properties-overlay'
import { sanitizeFileName } from '@/lib/mount-index/character-vault'
import { logger } from '@/lib/logger'

export const NO_CANON_FALLBACK =
  '(no canonical identity recorded for this character yet)'

const OTHERS_FOLDER = 'Others'

/**
 * OTHER-pass canon source. `body` carries the raw vault file contents when
 * `source === 'vault'`, the subject's identity text when `source ===
 * 'identity'`, the subject's description text when `source === 'description'`,
 * or null when nothing is on file.
 */
export interface CanonSource {
  characterId: string
  characterName: string
  body: string | null
  source: 'vault' | 'identity' | 'description' | 'none'
}

/**
 * SELF-pass canon: the subject's own vantage-point fields, held separately so
 * the renderer can label each one. Empty fields are dropped at render time.
 */
export interface SelfCanon {
  characterId: string
  characterName: string
  manifesto: string | null
  personality: string | null
  description: string | null
  identity: string | null
}

/**
 * Render a SELF canon into the ALREADY ESTABLISHED block. Fields are labelled
 * and rendered manifesto-first (the axiomatic floor), then personality,
 * description, identity. Any empty field is omitted; if none are present, the
 * NO_CANON_FALLBACK line is emitted.
 */
export function renderSelfCanonBlock(canon: SelfCanon): string {
  const fields: Array<[string, string | null]> = [
    ['MANIFESTO', canon.manifesto],
    ['PERSONALITY', canon.personality],
    ['DESCRIPTION', canon.description],
    ['IDENTITY', canon.identity],
  ]
  const lines: string[] = []
  const fieldsPresent: string[] = []
  for (const [label, value] of fields) {
    const trimmed = value?.trim()
    if (trimmed && trimmed.length > 0) {
      lines.push(`[${label}] ${trimmed}`)
      fieldsPresent.push(label)
    }
  }
  logger.debug('[Memory] SELF canon assembled', {
    characterId: canon.characterId,
    fieldsPresent,
  })
  const body = lines.length > 0 ? lines.join('\n') : NO_CANON_FALLBACK
  return `ALREADY ESTABLISHED about ${canon.characterName}\n${body}`
}

/**
 * Render an OTHER canon into the ALREADY ESTABLISHED block. A vault body is
 * rendered raw (it is the observer's own authored notes); the identity and
 * description fallbacks are labelled; absence emits NO_CANON_FALLBACK.
 */
export function renderOtherCanonBlock(canon: CanonSource): string {
  const trimmed = canon.body?.trim()
  let body: string
  if (canon.source === 'vault' && trimmed && trimmed.length > 0) {
    body = trimmed
  } else if (canon.source === 'identity' && trimmed && trimmed.length > 0) {
    body = `[IDENTITY] ${trimmed}`
  } else if (canon.source === 'description' && trimmed && trimmed.length > 0) {
    body = `[DESCRIPTION] ${trimmed}`
  } else {
    body = NO_CANON_FALLBACK
  }
  logger.debug('[Memory] OTHER canon assembled', {
    characterId: canon.characterId,
    source: canon.source,
  })
  return `ALREADY ESTABLISHED about ${canon.characterName}\n${body}`
}

/**
 * SELF-pass canon: the character's own vantage-point fields, no vault lookup.
 * The renderer (`renderSelfCanonBlock`) decides which fields appear.
 */
export function loadCanonForSelf(character: {
  id: string
  name: string
  manifesto: string | null
  personality: string | null
  description: string | null
  identity: string | null
}): SelfCanon {
  return {
    characterId: character.id,
    characterName: character.name,
    manifesto: character.manifesto ?? null,
    personality: character.personality ?? null,
    description: character.description ?? null,
    identity: character.identity ?? null,
  }
}

/**
 * OTHER-pass canon: try the observer's vault `Others/<subject-name>.md` first,
 * fall back to the subject's identity property, and to description only when
 * identity is empty. Never personality or manifesto — an observer cannot see
 * another character's interior or axiomatic core.
 */
export async function loadCanonForObserverAboutSubject(
  observer: { characterId: string; mountPointId: string | null },
  subject: { id: string; name: string; identity: string | null; description: string | null },
): Promise<CanonSource> {
  if (observer.mountPointId) {
    const path = `${OTHERS_FOLDER}/${sanitizeFileName(subject.name)}.md`
    const fromVault = await readVaultTextFile(
      observer.mountPointId,
      path,
      observer.characterId,
    )
    const trimmedVault = fromVault?.trim()
    if (trimmedVault && trimmedVault.length > 0) {
      return {
        characterId: subject.id,
        characterName: subject.name,
        body: trimmedVault,
        source: 'vault',
      }
    }
  }

  const trimmedIdentity = subject.identity?.trim()
  if (trimmedIdentity && trimmedIdentity.length > 0) {
    return {
      characterId: subject.id,
      characterName: subject.name,
      body: trimmedIdentity,
      source: 'identity',
    }
  }

  const trimmedDescription = subject.description?.trim()
  if (trimmedDescription && trimmedDescription.length > 0) {
    return {
      characterId: subject.id,
      characterName: subject.name,
      body: trimmedDescription,
      source: 'description',
    }
  }

  return {
    characterId: subject.id,
    characterName: subject.name,
    body: null,
    source: 'none',
  }
}
