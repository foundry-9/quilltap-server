/**
 * Answer Confirmation Service
 *
 * Before a character's tool-using Salon reply "lands", a cheap-LLM consistency
 * check compares the reply against what the character was told this turn (the
 * Commonplace Book whisper) and what it looked up (in-scope read-tool results).
 * If the reply looks inconsistent, the character's OWN model is invited to
 * affirm or rewrite it.
 *
 *   consistent            → confirmed:true
 *   inconsistent, stood by → confirmed:false (notes = discrepancies)
 *   inconsistent, rewrote  → confirmed:true, revised:true (original kept for logs)
 *   check errored/timeout  → confirmed:null (could-not-verify)
 *
 * The whole block is a no-op when the feature is inactive or there is nothing
 * to check (no whisper AND no in-scope read tool this turn).
 *
 * See docs/developer/features/salon-answer-confirmation.md.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { resolveUncensoredCheapLLMSelection, type CheapLLMSelection } from '@/lib/llm/cheap-llm'
import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution'
import type { UncensoredFallbackOptions, CheapLLMTaskResult } from '@/lib/memory/cheap-llm-tasks/types'
import type { LLMMessage } from '@/lib/llm/base'
import type { ConnectionProfile, MessageEvent, ChatMetadataBase } from '@/lib/schemas/types'
import type { ToolMessage } from './types'

const logger = createServiceLogger('AnswerConfirmation')

export type AnswerConfirmationOverride = 'ON' | 'OFF' | null | undefined

/**
 * Read tools whose results are worth checking a reply against. Content reads
 * only — web search, prior-conversation reads, and the Scriptorium `doc_*`
 * content-read family. Listing / binary-blob reads are intentionally excluded.
 * Names verified against the ALWAYS_PRIVATE_TOOLS / VAULT_READ_TOOLS sets in
 * tool-execution.service.ts.
 */
export const CONFIRMATION_READ_TOOLS: ReadonlySet<string> = new Set<string>([
  'search',
  'read_conversation',
  'doc_read_file',
  'doc_grep',
  'doc_read_heading',
  'doc_read_frontmatter',
  'doc_open_document',
])

/** Char budget for the assembled reference block handed to the cheap LLM. */
const REFERENCE_CHAR_BUDGET = 24_000

/** Default timeouts (ms). The check is cheap; the re-affirmation is a full model. */
const CONSISTENCY_CHECK_TIMEOUT_MS = 25_000
const REAFFIRMATION_TIMEOUT_MS = 60_000

/**
 * Resolve whether the answer-confirmation check is active for a chat, given the
 * three-level gate: per-chat override wins, then the per-project override, then
 * the global default. `'OFF'` always beats an inherited `'ON'` at its own level
 * because it is checked first.
 */
export function isAnswerConfirmationActive(
  chatOverride: AnswerConfirmationOverride,
  projectOverride: AnswerConfirmationOverride,
  globalEnabled: boolean | undefined,
): boolean {
  if (chatOverride === 'ON') return true
  if (chatOverride === 'OFF') return false
  if (projectOverride === 'ON') return true
  if (projectOverride === 'OFF') return false
  return globalEnabled === true
}

/**
 * True when there is something to check this turn: a Commonplace Book whisper
 * was found for this character AND/OR at least one in-scope read-tool result
 * ran. Plain turns with neither are skipped entirely.
 */
export function hasCheckableInputs(
  whisper: string | null | undefined,
  toolMessages: ToolMessage[],
): boolean {
  if (whisper && whisper.trim().length > 0) return true
  return toolMessages.some((tm) => CONFIRMATION_READ_TOOLS.has(tm.toolName))
}

/**
 * The most-recent Commonplace Book whisper targeted at this character this
 * turn. Whispers are written (targeted, private) just before generation, so the
 * last `commonplaceBook` message addressed to this participant is the one the
 * character saw. Returns its raw `content`, or null if none.
 */
export function findLatestCommonplaceWhisper(
  messages: MessageEvent[],
  participantId: string,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (
      m.type === 'message' &&
      m.systemSender === 'commonplaceBook' &&
      Array.isArray(m.targetParticipantIds) &&
      m.targetParticipantIds.includes(participantId) &&
      typeof m.content === 'string' &&
      m.content.trim().length > 0
    ) {
      return m.content
    }
  }
  return null
}

/**
 * True when this turn was authored by a user-controlled participant
 * (impersonation). Such replies are never checked — the human may have sourced
 * facts out of band — and are persisted with an explicit `confirmed:null`.
 */
export function isUserDrivenTurn(
  chat: Pick<ChatMetadataBase, 'participants' | 'impersonatingParticipantIds'>,
  participantId: string,
): boolean {
  if (Array.isArray(chat.impersonatingParticipantIds) && chat.impersonatingParticipantIds.includes(participantId)) {
    return true
  }
  const participant = chat.participants?.find((p) => p.id === participantId)
  return participant?.controlledBy === 'user'
}

/** Compactly serialize an in-scope tool result for the reference block. */
function serializeToolResult(tm: ToolMessage): string {
  const args = tm.arguments && Object.keys(tm.arguments).length > 0
    ? `\nArguments: ${JSON.stringify(tm.arguments)}`
    : ''
  return `[Tool: ${tm.toolName}${tm.success ? '' : ' (failed)'}]${args}\nResult: ${tm.content}`
}

/**
 * Assemble the reference block (whisper + in-scope tool results) the cheap LLM
 * checks the reply against. Returns `null` when there is nothing to check.
 * Truncates oldest-first to keep within the char budget.
 */
export function gatherConfirmationInputs(
  whisper: string | null | undefined,
  toolMessages: ToolMessage[],
): string | null {
  const inScopeTools = toolMessages.filter((tm) => CONFIRMATION_READ_TOOLS.has(tm.toolName))
  if (!hasCheckableInputs(whisper, toolMessages)) return null

  const sections: string[] = []
  if (whisper && whisper.trim().length > 0) {
    sections.push(`=== What the character recalled this turn (Commonplace Book) ===\n${whisper.trim()}`)
  }
  for (const tm of inScopeTools) {
    sections.push(`=== Lookup result ===\n${serializeToolResult(tm)}`)
  }

  let reference = sections.join('\n\n')
  if (reference.length > REFERENCE_CHAR_BUDGET) {
    // Truncate oldest-first: drop from the front until within budget, keeping
    // the most-recent lookups (which are usually the ones the reply leans on).
    reference = reference.slice(reference.length - REFERENCE_CHAR_BUDGET)
    reference = `[…earlier reference material truncated…]\n${reference}`
  }
  return reference
}

const CONSISTENCY_SYSTEM_PROMPT = `You are a consistency checker. You are given (A) reference information a character was working from this turn — their recalled memories and the results of any lookups/searches/document reads they performed — and (B) the reply they are about to send. Decide whether the reply is consistent with the reference information: it must not contradict it, invent facts that conflict with it, or misstate what the lookups returned. The reply may add in-character color, tone, or opinion not present in the reference — that is fine and not an inconsistency. Only flag genuine factual contradictions or misrepresentations of the reference. Respond with strict JSON: {"consistent": boolean, "discrepancies": string}. When consistent, discrepancies is "". When not, discrepancies briefly lists each contradiction in plain language.`

function buildReaffirmationSystemPrompt(): string {
  return `You are reconsidering a reply you just drafted, in your own voice, before it is sent. Some of what you wrote appears to conflict with what you actually know or looked up this turn. Respond ONLY with strict JSON.`
}

interface ConsistencyVerdict {
  consistent: boolean
  discrepancies: string
}

interface ReaffirmationVerdict {
  revise: boolean
  reply?: string
}

/** Extract a JSON object from a possibly fenced/wrapped LLM response. */
function extractJson(content: string): unknown {
  const trimmed = content.trim()
  // Strip ```json fences if present.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenceMatch ? fenceMatch[1].trim() : trimmed
  // Find the first {...} span if there's leading/trailing prose.
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  const jsonText = start >= 0 && end > start ? body.slice(start, end + 1) : body
  return JSON.parse(jsonText)
}

function parseConsistencyVerdict(content: string): ConsistencyVerdict {
  const obj = extractJson(content) as Record<string, unknown>
  if (typeof obj.consistent !== 'boolean') {
    throw new Error('consistency verdict missing boolean "consistent"')
  }
  return {
    consistent: obj.consistent,
    discrepancies: typeof obj.discrepancies === 'string' ? obj.discrepancies : '',
  }
}

function parseReaffirmationVerdict(content: string): ReaffirmationVerdict {
  const obj = extractJson(content) as Record<string, unknown>
  if (typeof obj.revise !== 'boolean') {
    throw new Error('re-affirmation verdict missing boolean "revise"')
  }
  return {
    revise: obj.revise,
    reply: typeof obj.reply === 'string' ? obj.reply : undefined,
  }
}

/** Reject a promise after `ms`, so a hung LLM call degrades to `confirmed:null`. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

/**
 * The resolved outcome the finalizer applies to the persisted message.
 * `confirmed === undefined` never occurs here — the finalizer only calls this
 * when the feature is active and there are checkable inputs.
 */
export interface AnswerConfirmationOutcome {
  confirmed: boolean | null
  revised: boolean
  notes: string | null
  /** Present only when `revised` — the replacement reply text. */
  revisedContent: string | null
}

export interface RunAnswerConfirmationOptions {
  reply: string
  reference: string
  userId: string
  chatId: string
  messageId?: string
  characterId?: string
  /** Already-resolved cheap-LLM selection (compression.cheapLLMSelection). */
  cheapLLMSelection: CheapLLMSelection | null
  /** The character's own model, used verbatim for the re-affirmation pass. */
  connectionProfile: ConnectionProfile
  isDangerousChat: boolean
  uncensoredFallback?: UncensoredFallbackOptions
  /** Emitted just before the re-affirmation pass (only when a rewrite is invited). */
  onAffirming?: () => void
}

/**
 * Run the consistency check and, if needed, the re-affirmation pass. Never
 * throws — any failure resolves to `confirmed:null`.
 */
export async function runAnswerConfirmation(
  opts: RunAnswerConfirmationOptions,
): Promise<AnswerConfirmationOutcome> {
  const {
    reply, reference, userId, chatId, messageId, characterId,
    cheapLLMSelection, connectionProfile, isDangerousChat, uncensoredFallback, onAffirming,
  } = opts

  if (!cheapLLMSelection) {
    logger.debug('Answer confirmation skipped: no cheap-LLM selection available', { chatId })
    return { confirmed: null, revised: false, notes: null, revisedContent: null }
  }

  // Upgrade to the uncensored cheap profile iff the Concierge flagged this chat.
  const selection = resolveUncensoredCheapLLMSelection(
    cheapLLMSelection,
    isDangerousChat,
    uncensoredFallback?.dangerSettings,
    uncensoredFallback?.availableProfiles ?? [],
  )

  const checkMessages: LLMMessage[] = [
    { role: 'system', content: CONSISTENCY_SYSTEM_PROMPT },
    { role: 'user', content: `--- REFERENCE INFORMATION ---\n${reference}\n\n--- REPLY TO CHECK ---\n${reply}` },
  ]

  let check: CheapLLMTaskResult<ConsistencyVerdict>
  try {
    check = await withTimeout(
      executeCheapLLMTask<ConsistencyVerdict>(
        selection,
        checkMessages,
        userId,
        parseConsistencyVerdict,
        'answer-confirmation',
        chatId,
        messageId,
        uncensoredFallback,
        512,
        characterId,
      ),
      CONSISTENCY_CHECK_TIMEOUT_MS,
      'answer-confirmation check',
    )
  } catch (error) {
    logger.warn('Answer confirmation check failed/timed out; marking unverified', {
      chatId, error: error instanceof Error ? error.message : String(error),
    })
    return { confirmed: null, revised: false, notes: null, revisedContent: null }
  }

  if (!check.success || !check.result) {
    logger.warn('Answer confirmation check errored; marking unverified', { chatId, error: check.error })
    return { confirmed: null, revised: false, notes: null, revisedContent: null }
  }

  if (check.result.consistent) {
    logger.debug('Answer confirmation: consistent', { chatId })
    return { confirmed: true, revised: false, notes: null, revisedContent: null }
  }

  const discrepancies = check.result.discrepancies || 'The reply appears inconsistent with the reference information.'
  logger.info('Answer confirmation: inconsistency flagged, requesting affirmation', { chatId })
  onAffirming?.()

  // Re-affirmation: the character's OWN model, given the discrepancies, chooses
  // to stand by the reply or rewrite it. Reuse the cheap-task harness with a
  // selection built from the character's connection profile (handles provider
  // creation, API-key resolution, and LLM logging).
  const reaffSelection: CheapLLMSelection = {
    provider: connectionProfile.provider,
    modelName: connectionProfile.modelName,
    baseUrl: connectionProfile.baseUrl || undefined,
    connectionProfileId: connectionProfile.id,
    isLocal: false,
    profileParameters: connectionProfile.parameters && typeof connectionProfile.parameters === 'object'
      ? (connectionProfile.parameters as Record<string, unknown>)
      : undefined,
  }

  const reaffUser = [
    'You drafted this reply this turn:',
    '"""',
    reply,
    '"""',
    '',
    'A consistency check flagged these apparent conflicts with what you know or looked up this turn:',
    discrepancies,
    '',
    'For reference, here is what you actually knew and looked up this turn:',
    reference,
    '',
    'If, on reflection, you stand by your reply exactly as written, respond with strict JSON {"revise": false}. If you want to correct it, respond with {"revise": true, "reply": "<your corrected reply>"} — the corrected reply replaces what you send, so write it in full and in your own voice.',
  ].join('\n')

  const reaffMessages: LLMMessage[] = [
    { role: 'system', content: buildReaffirmationSystemPrompt() },
    { role: 'user', content: reaffUser },
  ]

  let reaff: CheapLLMTaskResult<ReaffirmationVerdict>
  try {
    reaff = await withTimeout(
      executeCheapLLMTask<ReaffirmationVerdict>(
        reaffSelection,
        reaffMessages,
        userId,
        parseReaffirmationVerdict,
        'answer-reaffirmation',
        chatId,
        messageId,
        undefined,
        4096,
        characterId,
      ),
      REAFFIRMATION_TIMEOUT_MS,
      'answer-reaffirmation',
    )
  } catch (error) {
    logger.warn('Answer re-affirmation failed/timed out; marking unverified', {
      chatId, error: error instanceof Error ? error.message : String(error),
    })
    return { confirmed: null, revised: false, notes: discrepancies, revisedContent: null }
  }

  if (!reaff.success || !reaff.result) {
    logger.warn('Answer re-affirmation errored; marking unverified', { chatId, error: reaff.error })
    return { confirmed: null, revised: false, notes: discrepancies, revisedContent: null }
  }

  if (reaff.result.revise && reaff.result.reply && reaff.result.reply.trim().length > 0) {
    logger.info('Answer confirmation: character revised the reply', { chatId })
    return { confirmed: true, revised: true, notes: discrepancies, revisedContent: reaff.result.reply }
  }

  if (reaff.result.revise) {
    // Wanted to revise but gave no usable text — don't gamble on a broken rewrite.
    logger.warn('Answer re-affirmation requested revision without text; marking unverified', { chatId })
    return { confirmed: null, revised: false, notes: discrepancies, revisedContent: null }
  }

  logger.info('Answer confirmation: character stood by the flagged reply', { chatId })
  return { confirmed: false, revised: false, notes: discrepancies, revisedContent: null }
}
