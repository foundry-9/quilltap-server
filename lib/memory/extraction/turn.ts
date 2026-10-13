/**
 * Turn-grain extraction (memory refactor §3.7): one closed turn, or one Carina
 * answer, through the `self-turn` and `other-turn` passes on one context.
 *
 * A turn is addressed by its opener (the USER message that opened it, or null
 * for a greeting / continue turn) and, in autonomous rooms, by the ASSISTANT
 * message that closes it. Carina's answer is not part of any turn transcript
 * (every staff message is skipped), so it gets a one-slice transcript of its
 * own: the question opens it, the answerer's reply is its only slice, and with
 * no user character in it only SELF memories form.
 *
 * @module memory/extraction/turn
 */

import type { Character, MessageEvent } from '@/lib/schemas/types'
import { buildTurnTranscript, type TurnTranscript } from '@/lib/services/chat-message/turn-transcript'
import { logger } from '@/lib/logger'
import type { ExtractionContext } from './context'
import { emptyPassResult, mergePassResult, runPass, type PassResult } from './run'
import { selfTurnPass } from './passes/self-turn'
import { otherTurnPass } from './passes/other-turn'
import { turnWindow } from './window'

export interface TurnLocator {
  turnOpenerMessageId: string | null
  extractionAnchorMessageId?: string | null
}

export interface TurnExtractionResult extends PassResult {
  /** The message the turn's debug log lines are kept on (its latest assistant message). */
  sourceMessageId: string | null
  /** False when the turn held no character contribution. */
  hadContributions: boolean
}

/** The cast as the transcript builder takes it. */
function castCharacters(ctx: ExtractionContext): Map<string, Character> {
  return new Map([...ctx.cast.values()].map(m => [m.characterId, m.character]))
}

/** The transcript of one turn, built against the context's cast. */
export async function turnTranscriptFor(ctx: ExtractionContext, locator: TurnLocator): Promise<TurnTranscript> {
  const user = ctx.userCharacter
  return buildTurnTranscript(await ctx.messages(), ctx.chat.participants, castCharacters(ctx), {
    turnOpenerMessageId: locator.turnOpenerMessageId,
    extractionAnchorMessageId: locator.extractionAnchorMessageId ?? null,
    userCharacterId: user?.characterId,
    userCharacterName: user?.name,
    userCharacterPronouns: user?.pronouns ?? null,
  })
}

/** Run the turn passes over a built transcript: SELF for every slice, then OTHER (by mode). */
export async function runTurnPasses(
  ctx: ExtractionContext,
  transcript: TurnTranscript,
  opts: { candidatePass?: 'self-turn' | 'carina' } = {},
): Promise<TurnExtractionResult> {
  const result: TurnExtractionResult = {
    ...emptyPassResult('self-turn'),
    sourceMessageId: transcript.latestAssistantMessageId,
    hadContributions: transcript.characterSlices.length > 0,
  }
  if (!result.hadContributions) {
    result.debugLogs.push('[Memory] Turn has no character contributions — nothing to extract')
    return result
  }
  const window = turnWindow(transcript)
  mergePassResult(result, await runPass(selfTurnPass(opts.candidatePass ?? 'self-turn'), ctx, window))
  if (ctx.settings.mode.otherPass === 'fold') {
    result.debugLogs.push('[Memory] OTHER pass runs at fold grain only (otherPass=fold); skipping per-turn OTHER')
  } else {
    mergePassResult(result, await runPass(otherTurnPass(), ctx, window))
  }
  logger.debug('[Memory] Turn extraction complete', {
    chatId: ctx.chat.id,
    turnOpenerMessageId: transcript.turnOpenerMessageId,
    dryRun: ctx.dryRun,
    candidates: result.admitted.length,
    created: result.createdIds.length,
    reinforced: result.reinforcedIds.length,
    timedOut: result.timedOut,
  })
  return result
}

/** One closed turn, located in the chat. */
export async function runTurnExtraction(ctx: ExtractionContext, locator: TurnLocator): Promise<TurnExtractionResult> {
  return runTurnPasses(ctx, await turnTranscriptFor(ctx, locator))
}

/**
 * The one-slice transcript of a Carina answer: the question opens it, the
 * answer is the answerer's only contribution. Null when the answer is empty
 * or the answerer is not in the context's cast.
 */
export function carinaTranscript(ctx: ExtractionContext, message: MessageEvent, answererId: string): TurnTranscript | null {
  const answerer = ctx.cast.get(answererId)
  const answer = message.content?.trim() ?? ''
  if (!answerer || !answer) return null
  const question = message.carinaMeta?.question?.trim() ?? ''
  return {
    turnOpenerMessageId: null,
    userMessage: question.length > 0 ? question : null,
    userCharacterId: undefined,
    userCharacterName: undefined,
    userCharacterPronouns: null,
    characterSlices: [{
      characterId: answerer.characterId,
      characterName: answerer.name,
      characterPronouns: answerer.pronouns,
      text: answer,
      contributingMessageIds: [message.id],
      lastMessageCreatedAt: message.createdAt ?? null,
    }],
    latestAssistantMessageId: message.id,
    turnTimestamp: message.createdAt ?? null,
  }
}

/**
 * A Carina answer's memories: SELF only, with the `carina` provenance. The
 * context's user character is set aside, so the answerer forms nothing about
 * the asker.
 */
export async function runCarinaExtraction(
  ctx: ExtractionContext,
  message: MessageEvent,
  answererId: string,
): Promise<TurnExtractionResult | null> {
  const transcript = carinaTranscript(ctx, message, answererId)
  if (!transcript) return null
  // With the answerer the only speaker and no user character, the OTHER pass has no subject.
  return runTurnPasses({ ...ctx, userCharacter: null }, transcript, { candidatePass: 'carina' })
}
