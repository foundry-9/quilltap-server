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
import { withPriorAsMaterial } from '@/lib/services/chat-message/turn-transcript'

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
      // Everyone who spoke in the turn observes and is observed, lines an
      // earlier extraction covered included (bug 245). A speaker from that
      // earlier part has observed it already: it reads only the new lines, and
      // is not asked when nobody else said anything new. A speaker new to the
      // turn observes all of it.
      const priorSpeakerIds = new Set((transcript.priorSlices ?? []).map(s => s.characterId))
      const newSpeakerIds = new Set(transcript.characterSlices.map(s => s.characterId))
      const allSlices = [...(transcript.priorSlices ?? []), ...transcript.characterSlices]
      const observerSlices = new Map<string, (typeof allSlices)[number]>()
      for (const slice of allSlices) observerSlices.set(`${slice.isUserControlled ? 'user' : 'ai'}:${slice.characterId}`, slice)
      const speakers = [...observerSlices.values()]
        .map(slice => ctx.cast.get(slice.characterId))
        .filter((m): m is CastMember => !!m)
      const pool = subjectPool(ctx, speakers)
      const wholeTurn = withPriorAsMaterial(transcript)

      const calls: PassCall[] = []
      for (const slice of observerSlices.values()) {
        const observer = ctx.cast.get(slice.characterId)
        if (!observer) continue
        const sawEarlierPart = priorSpeakerIds.has(observer.characterId)
        if (sawEarlierPart && ![...newSpeakerIds].some(id => id !== observer.characterId)) continue
        const view = sawEarlierPart ? transcript : wholeTurn
        const subjects = await subjectInputsFor(ctx, observer, pool)
        if (subjects.length === 0) continue
        // An observer with no new line of its own observes the new lines: date
        // its memories by the turn's latest message, not its own earlier one.
        const ownNew = newSpeakerIds.has(observer.characterId) ? slice : null
        const sourceMessageId =
          ownNew?.contributingMessageIds[ownNew.contributingMessageIds.length - 1] ?? transcript.latestAssistantMessageId
        const sourceTime = firstValidIso(ownNew?.lastMessageCreatedAt ?? null, transcript.turnTimestamp)
        calls.push({
          label: `OTHER memory ${observer.name}${slice.isUserControlled ? ' (user-controlled)' : ''} → ${subjects.length} subject(s)`,
          holders: [observer],
          logCharacterId: observer.characterId,
          messages: buildOtherTurnMessages({
            transcript: view,
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
