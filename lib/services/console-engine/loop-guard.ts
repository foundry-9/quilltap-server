/**
 * Console engine — the loop guards.
 *
 * Shared by the console engine's streaming loop (`./engine.ts`) and the
 * in-memory one-shot loop (`lib/services/agent-loop/one-shot-loop.ts`).
 *
 * Two parts:
 *
 *  - `normalizeToolCallSignature` — the stuck-loop guard's duplicate-call
 *    signature, used by every console and one-shot run.
 *  - `ResearchLoopGuard` — the research kit's four soft guards
 *    (docs/developer/features/research-kit.md §8): the checkpoint, declared
 *    sufficiency, the repeated miss and the repeated error. Each appends one
 *    user-role message to the next model call; none ends the run. Only the
 *    research kinds (`inquiry`, `drafting`, `writing`) run them.
 *
 * @module lib/services/console-engine/loop-guard
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { editDistance } from '@/lib/research/text'
import type { AgentInstructionKind } from '@/lib/services/chat-message/agent-mode-resolver.service'

const logger = createServiceLogger('ConsoleLoopGuard')

/**
 * Normalize a batch of tool calls into a stable signature for loop detection.
 * String argument values (notably SQL) are whitespace-collapsed and lowercased
 * so cosmetic reformatting — extra spaces, a trailing semicolon's surrounding
 * whitespace, case changes — does not read as a "different" call. Semantic
 * variation still differs (that is what the stale-result signal catches).
 */
export function normalizeToolCallSignature(
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
): string {
  const normalizeValue = (value: unknown): unknown =>
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().toLowerCase() : value
  return JSON.stringify(
    toolCalls.map(tc => ({
      name: tc.name,
      arguments: Object.fromEntries(
        Object.entries(tc.arguments)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => [key, normalizeValue(value)]),
      ),
    })),
  )
}

// ============================================================================
// The research guards
// ============================================================================

/** Which wording the guards use: an answer, or a piece. */
export type ResearchGuardVariant = 'inquiry' | 'drafting'

/** Whether a kind is one of the research kit's (it hears the discipline and runs the guards). */
export function isResearchKitKind(kind: AgentInstructionKind): kind is 'writing' | 'inquiry' | 'drafting' {
  return kind === 'writing' || kind === 'inquiry' || kind === 'drafting'
}

/** The guard for a run of this kind, or null when the kind runs none. */
export function researchGuardFor(
  kind: AgentInstructionKind,
  opts: { maxAgentTurns: number; surface: string },
): ResearchLoopGuard | null {
  if (!isResearchKitKind(kind)) return null
  return new ResearchLoopGuard({ variant: kind === 'inquiry' ? 'inquiry' : 'drafting', ...opts })
}

/** The model call after which the first checkpoint fires. */
export const CHECKPOINT_AFTER_MODEL_CALL = 6
/** The share of the turn budget at which the second checkpoint fires (when later than the first). */
export const CHECKPOINT_BUDGET_SHARE = 0.6

/**
 * Phrases by which a model declares it has what it needs. English only by
 * design: the reasoning read is the model's own, in the prompt's language.
 */
export const SUFFICIENCY_PHRASES: readonly string[] = [
  'i have enough',
  'i have plenty',
  "i've got enough",
  "i've got plenty",
  'that is enough',
  "that's enough",
  'enough to answer',
  'enough to write',
  'enough to draft',
  'enough information',
]

/** Normalize a model's text for phrase matching: curly quotes, case, spacing. */
function foldForPhrases(text: string): string {
  return text.replace(/[‘’ʼ]/g, "'").replace(/\s+/g, ' ').toLowerCase()
}

/** Whether a model's reasoning or text declares that it has enough. */
export function declaresSufficiency(text: string): boolean {
  if (!text) return false
  const folded = foldForPhrases(text)
  return SUFFICIENCY_PHRASES.some((phrase) => folded.includes(phrase))
}

/** Tools a model should turn to when one keeps failing with the same error. */
const ALTERNATIVE_TOOLS: Record<string, string> = {
  run_sql: 'the lookup shortcuts (`lookup_character`, `lookup_conversations`, `lookup_messages`, `find_documents`)',
  doc_grep: '`find_documents`',
  doc_list_files: '`list_documents`',
  doc_read_file: '`find_documents` to find the right path',
  find_documents: '`list_documents`',
  list_documents: '`find_documents`',
  lookup_messages: '`lookup_conversations`',
  lookup_conversations: '`lookup_messages`',
  read_messages: '`lookup_messages` with `conversation`',
}

/**
 * Whether a tool result reports that nothing was found. Errors are "misses"
 * only when they say not-found; other errors belong to the repeated-error guard.
 */
export function isEmptyToolResult(message: { success: boolean; content: string }): boolean {
  const text = message.content ?? ''
  if (/\b(not found|no such|does not exist|no (?:character|conversation|file|document|store|group|project|entry|atlas entry|wardrobe) (?:matches|named|called|with))\b/i.test(text)) {
    return true
  }
  if (!message.success) return false
  if (/\bno (?:matches|results|hits|files?|documents?|conversations?|memories|messages|entries|pieces)\b(?: (?:found|in|for|match))?/i.test(text)) return true
  if (/"(?:count|total|total_matches|totalFound|matches_found)"\s*:\s*0\b/.test(text)) return true
  if (/"(?:hits|matches|memories|results|files|conversations)"\s*:\s*\[\s*\]/.test(text)) return true
  return false
}

/** The words a call searched for: every string argument, folded and sorted. */
function searchWordsOf(args: Record<string, unknown> | undefined): string[] {
  if (!args) return []
  const words = new Set<string>()
  for (const value of Object.values(args)) {
    if (typeof value !== 'string') continue
    for (const word of value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/)) {
      if (word.length > 1) words.add(word)
    }
  }
  return [...words].sort()
}

/** Whether two searches look for near-identically the same thing. */
export function nearIdenticalTargets(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false
  const left = a.join(' ')
  const right = b.join(' ')
  if (left === right) return true
  const longest = Math.max(left.length, right.length)
  if (editDistance(left, right) <= Math.max(2, Math.floor(longest * 0.25))) return true
  // Shared words: the same subject with a word added or dropped.
  const shared = a.filter((w) => b.includes(w)).length
  return shared / Math.max(a.length, b.length) >= 0.6
}

/** Normalize an error text so the same failure compares equal across calls. */
function normalizeErrorText(text: string): string {
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 400)
}

/** A tool message as the guard reads it. */
export interface GuardToolMessage {
  toolName: string
  success: boolean
  content: string
  arguments?: Record<string, unknown>
}

export type ResearchGuardName = 'checkpoint' | 'sufficiency' | 'repeated-miss' | 'repeated-error'

export interface ResearchLoopGuardOptions {
  variant: ResearchGuardVariant
  /** The run's turn budget (for the 60% checkpoint). */
  maxAgentTurns: number
  /** The surface, for the debug log (e.g. `brahma-console`, `Atlas lore draft`). */
  surface: string
}

/**
 * The research kit's soft guards for one run. The loop tells it what happened
 * (`afterModelCall`, `afterToolStep`) and asks it, before each model call,
 * for the message to append (`takeNudge`). Fire-once rules live here.
 */
export class ResearchLoopGuard {
  private readonly variant: ResearchGuardVariant
  private readonly surface: string
  private readonly checkpoints: number[]
  private modelCalls = 0
  private toolCalls = 0
  private sufficientToolSteps = 0
  private readonly fired = new Set<ResearchGuardName>()
  private readonly firedCheckpoints = new Set<number>()
  private readonly misses: Array<{ tool: string; words: string[] }> = []
  private readonly errors = new Map<string, number>()
  private pending: string[] = []
  /** Every guard that fired this run, in order (for logs and tests). */
  readonly history: ResearchGuardName[] = []

  constructor(options: ResearchLoopGuardOptions) {
    this.variant = options.variant
    this.surface = options.surface
    const second = Math.ceil(options.maxAgentTurns * CHECKPOINT_BUDGET_SHARE)
    this.checkpoints = second > CHECKPOINT_AFTER_MODEL_CALL
      ? [CHECKPOINT_AFTER_MODEL_CALL, second]
      : [CHECKPOINT_AFTER_MODEL_CALL]
  }

  /** A model call has returned (with or without tool calls). */
  afterModelCall(): void {
    this.modelCalls++
  }

  /**
   * A step that called tools has run. `thinking` is the step's reasoning and
   * prose together; `results` are the tool messages it produced, in call order.
   */
  afterToolStep(step: { thinking: string; callCount: number; results: readonly GuardToolMessage[] }): void {
    this.toolCalls += step.callCount

    if (step.callCount > 0 && declaresSufficiency(step.thinking)) {
      this.sufficientToolSteps++
      if (this.sufficientToolSteps >= 2) {
        const finish = this.variant === 'inquiry' ? 'Write the answer now.' : 'Deliver the piece now.'
        this.queueOnce('sufficiency', `You have said twice that you have enough. Do not call any more tools. ${finish}`)
      }
    }

    for (const result of step.results) {
      if (isEmptyToolResult(result)) {
        const words = searchWordsOf(result.arguments)
        const earlier = this.misses.some((m) => m.tool === result.toolName && nearIdenticalTargets(m.words, words))
        this.misses.push({ tool: result.toolName, words })
        if (earlier) {
          this.queueOnce(
            'repeated-miss',
            'That has been searched for twice and is not there. Treat it as absent; do not search for it again.',
          )
        }
        continue
      }
      if (!result.success) {
        const key = `${result.toolName}:${normalizeErrorText(result.content)}`
        const seen = (this.errors.get(key) ?? 0) + 1
        this.errors.set(key, seen)
        if (seen >= 2) {
          const alternative = ALTERNATIVE_TOOLS[result.toolName] ?? 'another tool'
          const finish = this.variant === 'inquiry' ? 'answer from what you have' : 'write the piece from what you have'
          this.queueOnce(
            'repeated-error',
            `\`${result.toolName}\` has failed twice with the same error. Do not call it again in this run; use ${alternative} or ${finish}.`,
          )
        }
      }
    }
  }

  /**
   * The message to append before the next model call, or null. Clears the
   * queue. Called at the top of each loop iteration, so the checkpoint counts
   * the tool calls of every step so far.
   */
  takeNudge(): string | null {
    if (this.checkpoints.includes(this.modelCalls) && !this.firedCheckpoints.has(this.modelCalls)) {
      this.firedCheckpoints.add(this.modelCalls)
      const finish = this.variant === 'inquiry'
        ? 'If you can answer, answer now.'
        : 'If you can write the piece, deliver it now.'
      this.queue(
        'checkpoint',
        `Checkpoint: you have made ${this.toolCalls} tool calls. ${finish} If not, name in one line the single thing still missing and make only the call that fetches it.`,
      )
    }
    if (this.pending.length === 0) return null
    const text = this.pending.join('\n\n')
    this.pending = []
    return text
  }

  private queueOnce(name: ResearchGuardName, text: string): void {
    if (this.fired.has(name)) return
    this.fired.add(name)
    this.queue(name, text)
  }

  private queue(name: ResearchGuardName, text: string): void {
    this.history.push(name)
    this.pending.push(text)
    logger.debug('Research loop guard fired', {
      surface: this.surface,
      guard: name,
      variant: this.variant,
      modelCalls: this.modelCalls,
      toolCalls: this.toolCalls,
    })
  }
}
