/**
 * The subjects an OTHER call covers, at either grain: the characters an
 * observer shares the window with, plus the user-controlled character even
 * when silent — never the observer itself, never twice.
 *
 * @module memory/extraction/passes/subjects
 */

import type { CastMember, ExtractionContext } from '../context'
import type { OtherSubjectInput } from '../prompts/other'

/** The window's speakers plus the user-controlled character, deduplicated, speakers first. */
export function subjectPool(ctx: ExtractionContext, speakers: ReadonlyArray<CastMember>): CastMember[] {
  const pool: CastMember[] = []
  const seen = new Set<string>()
  for (const m of [...speakers, ...(ctx.userCharacter ? [ctx.userCharacter] : [])]) {
    if (seen.has(m.characterId)) continue
    seen.add(m.characterId)
    pool.push(m)
  }
  return pool
}

/** The prompt's subject entries for one observer, each with the observer's canon about it. */
export async function subjectInputsFor(
  ctx: ExtractionContext,
  observer: CastMember,
  pool: ReadonlyArray<CastMember>,
): Promise<Array<{ member: CastMember; input: OtherSubjectInput; canonSource: string }>> {
  const out: Array<{ member: CastMember; input: OtherSubjectInput; canonSource: string }> = []
  for (const subject of pool) {
    if (subject.characterId === observer.characterId) continue
    const canon = await ctx.canonFor(observer.characterId, subject.characterId)
    out.push({
      member: subject,
      input: {
        id: subject.characterId,
        name: subject.name,
        pronouns: subject.pronouns,
        isUser: subject.isUser,
        canonBlock: canon.block,
      },
      canonSource: canon.source,
    })
  }
  return out
}
