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
 *
 * Commonplace feedback (memory-consolidation-and-tiers.md §C6). The
 * consolidation job mirrors each subject's hot digests into the holder's vault
 * at `Commonplace/<subject-name>.md` and `Commonplace/Self.md`. Those files are
 * appended to canon so a digested fact reads as ALREADY ESTABLISHED and stops
 * being re-mined:
 *
 *   - OTHER canon: the hand-written source above (vault `Others/` file, else
 *     identity, else description) **then** `Commonplace/<name>.md`.
 *   - SELF canon: the card fields **then** `Commonplace/Self.md`.
 *
 * The combined block is capped at {@link CANON_BLOCK_TOKEN_CAP}. Only the
 * digest yields to the cap — hand-written prose and card fields are never cut,
 * so a character with no Commonplace file renders byte-for-byte as before.
 */

import { readVaultTextFile } from '@/lib/database/repositories/character-properties-overlay'
import { sanitizeFileName } from '@/lib/mount-index/character-vault'
import { logger } from '@/lib/logger'
import { estimateTokens } from '@/lib/tokens/token-counter'
import {
  commonplacePathFor,
  commonplaceFileToCanonText,
  truncateToTokenBudget,
} from '@/lib/memory/commonplace-file'

export const NO_CANON_FALLBACK =
  '(no canonical identity recorded for this character yet)'

const OTHERS_FOLDER = 'Others'

/**
 * Token ceiling on one subject's whole ALREADY ESTABLISHED block (hand canon +
 * Commonplace digest). Sized so a full 1,500-token digest file still fits
 * beside a modest hand-written note, while a multi-subject OTHER call (one
 * block per subject) cannot balloon past a few thousand tokens per subject.
 * The digest is what gives way; hand prose is never truncated.
 */
export const CANON_BLOCK_TOKEN_CAP = 2500

/** Label introducing the Commonplace digest inside a canon block. */
const COMMONPLACE_LABEL = '[FROM THE COMMONPLACE BOOK]'

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
  /**
   * The observer's `Commonplace/<subject>.md` digest text (frontmatter and
   * heading stripped), when one exists. Rendered after `body`, trimmed to what
   * {@link CANON_BLOCK_TOKEN_CAP} leaves.
   */
  commonplace?: string | null
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
  /**
   * The character's own `Commonplace/Self.md` digest text, when one exists.
   * Rendered after the card fields, trimmed to what {@link CANON_BLOCK_TOKEN_CAP}
   * leaves.
   */
  commonplace?: string | null
}

/**
 * Append the Commonplace digest to an already-rendered canon block, giving it
 * only the tokens the hand-written part left under {@link CANON_BLOCK_TOKEN_CAP}.
 */
function appendCommonplace(block: string, commonplace: string | null | undefined): string {
  const digest = commonplace?.trim()
  if (!digest) return block
  const room = CANON_BLOCK_TOKEN_CAP - estimateTokens(block) - estimateTokens(COMMONPLACE_LABEL) - 2
  const fitted = truncateToTokenBudget(digest, room)
  if (!fitted) return block
  return `${block}\n${COMMONPLACE_LABEL}\n${fitted}`
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
  const hasDigest = !!canon.commonplace?.trim()
  // With a digest on file the fallback line would contradict it; drop it.
  const body = lines.length > 0 ? lines.join('\n') : hasDigest ? '' : NO_CANON_FALLBACK
  const head = body
    ? `ALREADY ESTABLISHED about ${canon.characterName}\n${body}`
    : `ALREADY ESTABLISHED about ${canon.characterName}`
  return appendCommonplace(head, canon.commonplace)
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
  } else if (canon.commonplace?.trim()) {
    // Nothing hand-written, but the Commonplace Book has notes — let them stand alone.
    return appendCommonplace(`ALREADY ESTABLISHED about ${canon.characterName}`, canon.commonplace)
  } else {
    body = NO_CANON_FALLBACK
  }
  return appendCommonplace(`ALREADY ESTABLISHED about ${canon.characterName}\n${body}`, canon.commonplace)
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
  /** Pre-loaded `Commonplace/Self.md` text (see {@link loadCommonplaceCanon}). */
  commonplace?: string | null
}): SelfCanon {
  return {
    characterId: character.id,
    characterName: character.name,
    manifesto: character.manifesto ?? null,
    personality: character.personality ?? null,
    description: character.description ?? null,
    identity: character.identity ?? null,
    ...(character.commonplace ? { commonplace: character.commonplace } : {}),
  }
}

/**
 * Read a Commonplace digest mirror from a holder's vault and return it as
 * canon text (frontmatter and heading stripped), or null when there is no
 * vault or no file. Never throws — a missing digest is not an error.
 */
export async function loadCommonplaceCanon(
  holder: { characterId: string; mountPointId: string | null },
  subject: 'self' | { id: string; name: string },
): Promise<string | null> {
  if (!holder.mountPointId) return null
  const path = commonplacePathFor(subject)
  try {
    const raw = await readVaultTextFile(holder.mountPointId, path, holder.characterId)
    const text = commonplaceFileToCanonText(raw)
    if (text) {
      logger.debug('[Canon] Commonplace digest loaded into canon', {
        characterId: holder.characterId,
        path,
        chars: text.length,
      })
    }
    return text
  } catch (error) {
    logger.debug('[Canon] Commonplace digest unavailable; canon continues without it', {
      characterId: holder.characterId,
      path,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * SELF-pass canon with the character's own `Commonplace/Self.md` appended
 * after the card fields. Same shape as {@link loadCanonForSelf}; the extra
 * `mountPointId` is the character's own vault.
 */
export async function loadCanonForSelfWithCommonplace(character: {
  id: string
  name: string
  manifesto: string | null
  personality: string | null
  description: string | null
  identity: string | null
  mountPointId: string | null
}): Promise<SelfCanon> {
  const commonplace = await loadCommonplaceCanon(
    { characterId: character.id, mountPointId: character.mountPointId },
    'self',
  )
  return loadCanonForSelf({ ...character, commonplace })
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
  options: {
    /**
     * Append the observer's `Commonplace/<subject>.md` digest (default true).
     * The consolidation call passes false — it is handed the digests directly.
     */
    includeCommonplace?: boolean
  } = {},
): Promise<CanonSource> {
  // Hand canon first, then the digest — the order the block renders in.
  const hand = await loadHandCanon(observer, subject)
  if (options.includeCommonplace === false) return hand
  const commonplace = await loadCommonplaceCanon(observer, { id: subject.id, name: subject.name })
  return commonplace ? { ...hand, commonplace } : hand
}

/** The hand-written half of OTHER canon: vault `Others/` file, else identity, else description. */
async function loadHandCanon(
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
