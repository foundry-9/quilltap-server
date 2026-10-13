/**
 * The `self-turn` pass: what each character who spoke in a closed turn retains
 * about themselves. One call per slice; the holder's own canon (card fields
 * and `Commonplace/Self.md`) is the ALREADY ESTABLISHED block. Carina's
 * answers run on this pass with the `carina` provenance.
 *
 * @module memory/extraction/passes/self-turn
 */

import { HARD_CANDIDATE_CAP, parseSelfDrafts, passCap } from '../parse'
import { buildSelfTurnMessages } from '../prompts/self'
import { clockAt, type ExtractionContext } from '../context'
import type { ExtractionPass, PassCall } from '../run'
import type { TranscriptWindow } from '../window'

export function selfTurnPass(candidatePass: 'self-turn' | 'carina' = 'self-turn'): ExtractionPass {
  return {
    name: 'self-turn',
    candidatePass,
    taskType: 'memory-extraction-self',
    async calls(ctx: ExtractionContext, window: TranscriptWindow): Promise<PassCall[]> {
      if (window.kind !== 'turn') return []
      const { transcript } = window
      const cap = passCap(HARD_CANDIDATE_CAP, ctx.route.maxTokens)
      const clock = clockAt(ctx, window.nowIso)
      const calls: PassCall[] = []
      for (const slice of transcript.characterSlices) {
        const holder = ctx.cast.get(slice.characterId)
        if (!holder) continue
        const messages = buildSelfTurnMessages({
          transcript,
          holderId: slice.characterId,
          canonBlock: await ctx.canonForSelf(slice.characterId),
          cap,
          inAutonomousRoom: ctx.inAutonomousRoom,
          orienting: ctx.orienting,
          clock,
        })
        if (!messages) continue
        const sourceMessageId =
          slice.contributingMessageIds[slice.contributingMessageIds.length - 1] ?? transcript.latestAssistantMessageId
        const sourceTime = slice.lastMessageCreatedAt ?? transcript.turnTimestamp ?? null
        calls.push({
          label: `SELF memory for ${holder.name}${slice.isUserControlled ? ' (user-controlled)' : ''}`,
          holders: [holder],
          messages,
          logCharacterId: holder.characterId,
          parse: raw => [{
            holders: [holder],
            about: null,
            drafts: parseSelfDrafts(raw, cap),
            source: { messageId: sourceMessageId, createdAt: sourceTime },
            anchors: { referenceIso: sourceTime ?? window.nowIso, fallbackIso: sourceTime ?? window.nowIso },
          }],
        })
      }
      return calls
    },
  }
}
