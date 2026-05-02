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
 *     from the character's own `identity` property. No vault lookup, since
 *     looking in `Others/<self>.md` for self-knowledge would be incoherent and
 *     would shadow the actual identity property.
 *
 *   - OTHER pass (a character extracting memories about another participant,
 *     including the user): canon comes from the observer's vault at
 *     `Others/<sanitized-subject-name>.md`, falling back to the subject's
 *     `identity` property if the vault file is absent or empty.
 */

import { readVaultTextFile } from '@/lib/database/repositories/character-properties-overlay'
import { sanitizeFileName } from '@/lib/mount-index/character-vault'
import { logger } from '@/lib/logger'

export const NO_CANON_FALLBACK =
  '(no canonical identity recorded for this character yet)'

const OTHERS_FOLDER = 'Others'

export interface CanonSource {
  characterId: string
  characterName: string
  /** Raw markdown body — vault file contents, or the identity property, or null. */
  body: string | null
  source: 'vault' | 'identity' | 'none'
}

/**
 * Render a CanonSource into the ALREADY ESTABLISHED block that gets dropped
 * directly into the system prompt.
 */
export function renderCanonBlock(source: CanonSource): string {
  const trimmed = source.body?.trim()
  const body = trimmed && trimmed.length > 0 ? trimmed : NO_CANON_FALLBACK
  return `ALREADY ESTABLISHED about ${source.characterName}\n${body}`
}

/**
 * SELF-pass canon: the character's own identity property, no vault lookup.
 */
export function loadCanonForSelf(character: {
  id: string
  name: string
  identity: string | null
}): CanonSource {
  const trimmed = character.identity?.trim()
  if (trimmed && trimmed.length > 0) {
    return {
      characterId: character.id,
      characterName: character.name,
      body: trimmed,
      source: 'identity',
    }
  }
  return {
    characterId: character.id,
    characterName: character.name,
    body: null,
    source: 'none',
  }
}

/**
 * OTHER-pass canon: try the observer's vault `Others/<subject-name>.md` first,
 * fall back to the subject's identity property.
 */
export async function loadCanonForObserverAboutSubject(
  observer: { characterId: string; mountPointId: string | null },
  subject: { id: string; name: string; identity: string | null },
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
      logger.debug('[Memory] canon source=vault', {
        observerId: observer.characterId,
        subjectId: subject.id,
        path,
      })
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

  return {
    characterId: subject.id,
    characterName: subject.name,
    body: null,
    source: 'none',
  }
}
