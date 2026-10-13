/**
 * The `other-fold` pass: what each character who spoke in a stretch took away
 * about the others, each thread stated once (memory consolidation, workstream
 * A). One multi-subject call per observer per stretch. Runs in the `fold` and
 * `hybrid` modes; the fold runner skips it in `turn`.
 *
 * The cap is `foldCandidatesPerSubject`, clamped by the output budget like the
 * turn cap, with the event slot the prompt promises honoured.
 *
 * @module memory/extraction/passes/other-fold
 */

import type { MessageEvent } from '@/lib/schemas/types'
import { parseOtherDraftsBySubject, passCap } from '../parse'
import { buildOtherFoldMessages } from '../prompts/other'
import { clockAt, type CastMember, type ExtractionContext } from '../context'
import type { ExtractionPass, PassCall } from '../run'
import { firstValidIso, type TranscriptWindow } from '../window'
import { subjectInputsFor, subjectPool } from './subjects'

/** The characters who spoke in a stretch, in order of first line, and each one's last message. */
export function stretchSpeakers(
  ctx: ExtractionContext,
  messages: ReadonlyArray<MessageEvent>,
): { speakers: CastMember[]; lastMessage: Map<string, MessageEvent> } {
  const byParticipant = new Map(
    [...ctx.cast.values()].filter(m => m.participantId).map(m => [m.participantId as string, m]),
  )
  const speakers: CastMember[] = []
  const lastMessage = new Map<string, MessageEvent>()
  for (const m of messages) {
    const member = m.participantId ? byParticipant.get(m.participantId) : undefined
    if (!member) continue
    if (!lastMessage.has(member.characterId)) speakers.push(member)
    lastMessage.set(member.characterId, m)
  }
  return { speakers, lastMessage }
}

export function otherFoldPass(): ExtractionPass {
  return {
    name: 'other-fold',
    candidatePass: 'other-fold',
    taskType: 'memory-extraction-other',
    async calls(ctx: ExtractionContext, window: TranscriptWindow): Promise<PassCall[]> {
      if (window.kind !== 'stretch' || window.messages.length === 0) return []
      const cap = passCap(ctx.settings.mode.foldCandidatesPerSubject, ctx.route.maxTokens)
      const clock = clockAt(ctx, window.nowIso)
      const { speakers, lastMessage } = stretchSpeakers(ctx, window.messages)
      const pool = subjectPool(ctx, speakers)
      if (speakers.length === 0 || pool.length < 2) return []

      const calls: PassCall[] = []
      for (const observer of speakers) {
        const subjects = await subjectInputsFor(ctx, observer, pool)
        if (subjects.length === 0) continue
        const last = lastMessage.get(observer.characterId) ?? window.messages[window.messages.length - 1]
        const sourceTime = firstValidIso(last?.createdAt)
        calls.push({
          label: `fold OTHER memory ${observer.name} → ${subjects.length} subject(s)`,
          holders: [observer],
          logCharacterId: observer.characterId,
          messages: buildOtherFoldMessages({
            stretch: window.rendered,
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
              source: { messageId: last?.id ?? null, createdAt: sourceTime },
              anchors: { referenceIso: sourceTime ?? window.nowIso, fallbackIso: window.nowIso },
            }))
          },
        })
      }
      return calls
    },
  }
}
