/**
 * The `self-turn` pass: what each character who spoke in a closed turn retains
 * about themselves. One call per slice; the holder's own canon (card fields
 * and `Commonplace/Self.md`) is the ALREADY ESTABLISHED block. Carina's
 * answers run on this pass with the `carina` provenance. A story character's
 * call, and every Carina call, also asks for stated particulars
 * (`statedParticularsFor`), which get a slot of their own in the parse.
 *
 * @module memory/extraction/passes/self-turn
 */

import { HARD_CANDIDATE_CAP, parseSelfDrafts, passCap } from '../parse'
import { buildSelfTurnMessages, type StatedParticularsMode } from '../prompts/self'
import { characterKindPolicy } from '@/lib/characters/kind'
import { clockAt, type ExtractionContext } from '../context'
import type { ExtractionPass, PassCall } from '../run'
import { firstValidIso, type TranscriptWindow } from '../window'

/**
 * Whether a SELF call asks for stated particulars, and in which form
 * (`prompts/self.ts`). A Carina answer always does: it is a reference answer.
 * An ordinary turn does for a story character an LLM is playing — the one
 * who may invent detail and must keep to it. An assistant's facts come from
 * its sources, and a human-played seat's lines are the operator's own, so
 * neither is asked.
 */
export function statedParticularsFor(
  candidatePass: 'self-turn' | 'carina',
  character: { kind?: unknown } | null | undefined,
  isUserControlled: boolean,
): StatedParticularsMode | null {
  if (candidatePass === 'carina') return 'carina'
  if (isUserControlled) return null
  return characterKindPolicy(character).storySection ? 'story' : null
}

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
        const statedParticulars = statedParticularsFor(candidatePass, holder.character, slice.isUserControlled ?? false)
        const messages = buildSelfTurnMessages({
          transcript,
          holderId: slice.characterId,
          canonBlock: await ctx.canonForSelf(slice.characterId),
          cap,
          inAutonomousRoom: ctx.inAutonomousRoom,
          orienting: ctx.orienting,
          clock,
          statedParticulars,
          priorTellings: statedParticulars ? await ctx.priorTellings(slice.characterId) : [],
        })
        if (!messages) continue
        const sourceMessageId =
          slice.contributingMessageIds[slice.contributingMessageIds.length - 1] ?? transcript.latestAssistantMessageId
        const sourceTime = firstValidIso(slice.lastMessageCreatedAt, transcript.turnTimestamp)
        calls.push({
          label: `SELF memory for ${holder.name}${slice.isUserControlled ? ' (user-controlled)' : ''}`,
          holders: [holder],
          messages,
          logCharacterId: holder.characterId,
          parse: raw => [{
            holders: [holder],
            about: null,
            drafts: parseSelfDrafts(raw, cap, { statedSlot: statedParticulars !== null }),
            source: { messageId: sourceMessageId, createdAt: sourceTime },
            anchors: { referenceIso: sourceTime ?? window.nowIso, fallbackIso: sourceTime ?? window.nowIso },
          }],
        })
      }
      return calls
    },
  }
}
