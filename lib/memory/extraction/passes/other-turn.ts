/**
 * The `other-turn` pass: what each character who spoke in a closed turn
 * retains about the others (and about the user-controlled character). One
 * multi-subject call per observer.
 *
 * Mode (`memoryExtractionMode.otherPass`): `turn` runs it whole; `hybrid` keeps
 * only what clears `perTurnOtherFloor` (commitments, agreements, new standing
 * facts), leaving the rest to the fold-grain pass; `fold` does not run it.
 *
 * @module memory/extraction/passes/other-turn
 */

import { HARD_CANDIDATE_CAP, parseOtherDraftsBySubject, passCap } from '../parse'
import { buildOtherTurnMessages } from '../prompts/other'
import { clockAt, type CastMember, type ExtractionContext } from '../context'
import type { ExtractionPass, PassCall } from '../run'
import { firstValidIso, type TranscriptWindow } from '../window'
import { subjectInputsFor, subjectPool } from './subjects'

export function otherTurnPass(): ExtractionPass {
  return {
    name: 'other-turn',
    candidatePass: 'other-turn',
    taskType: 'memory-extraction-other',
    async calls(ctx: ExtractionContext, window: TranscriptWindow): Promise<PassCall[]> {
      if (window.kind !== 'turn') return []
      const mode = ctx.settings.mode
      if (mode.otherPass === 'fold') return []
      const floor = mode.otherPass === 'hybrid'
        ? { value: mode.perTurnOtherFloor, reason: 'Hybrid floor (the rest is left to the fold-grain pass)' }
        : null
      const { transcript } = window
      const cap = passCap(HARD_CANDIDATE_CAP, ctx.route.maxTokens)
      const clock = clockAt(ctx, window.nowIso)
      const speakers = transcript.characterSlices
        .map(s => ctx.cast.get(s.characterId))
        .filter((m): m is CastMember => !!m)
      const pool = subjectPool(ctx, speakers)

      const calls: PassCall[] = []
      for (const slice of transcript.characterSlices) {
        const observer = ctx.cast.get(slice.characterId)
        if (!observer) continue
        const subjects = await subjectInputsFor(ctx, observer, pool)
        if (subjects.length === 0) continue
        const sourceMessageId =
          slice.contributingMessageIds[slice.contributingMessageIds.length - 1] ?? transcript.latestAssistantMessageId
        const sourceTime = firstValidIso(slice.lastMessageCreatedAt, transcript.turnTimestamp)
        calls.push({
          label: `OTHER memory ${observer.name}${slice.isUserControlled ? ' (user-controlled)' : ''} → ${subjects.length} subject(s)`,
          holders: [observer],
          logCharacterId: observer.characterId,
          messages: buildOtherTurnMessages({
            transcript,
            observer: { name: observer.name, pronouns: observer.pronouns },
            subjects: subjects.map(s => s.input),
            cap,
            inAutonomousRoom: ctx.inAutonomousRoom,
            orienting: ctx.orienting,
            clock,
          }),
          parse: raw => {
            const bySubject = parseOtherDraftsBySubject(raw, subjects.map(s => s.member.characterId), cap)
            return subjects.map(s => ({
              holders: [observer],
              about: s.member,
              drafts: bySubject.get(s.member.characterId) ?? [],
              floor,
              source: { messageId: sourceMessageId, createdAt: sourceTime },
              anchors: { referenceIso: sourceTime ?? window.nowIso, fallbackIso: sourceTime ?? window.nowIso },
            }))
          },
        })
      }
      return calls
    },
  }
}
