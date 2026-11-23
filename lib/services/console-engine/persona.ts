/**
 * Console engine — what a persona supplies (Calliope Live, Spec J
 * decision 2).
 *
 * A console is a character-less, memory-free assistant with its own
 * conversations (a `chats` row of the persona's chat type), its own tools and
 * its own engine setting. The engine (`./engine.ts`) runs the turn — the
 * user message, the model, the history and attachments, the tool loop and
 * its guards, persistence, frames — and asks the persona for everything that
 * is the persona's: who it is (the system prompt), what it may do (the tool
 * set, the text-block tool flags, the effect ceiling and the tool context),
 * where its attachments live, which model it falls back to, how many tool
 * rounds it may take, and what its final answer is stored as.
 *
 * The persona decides its plan once per turn (`planTurn`), so the loop never
 * tests a mode.
 *
 * @module lib/services/console-engine/persona
 */

import type { getRepositories } from '@/lib/repositories/factory'
import type { ChatMetadata, ChatType, ConnectionProfile, MessageEvent } from '@/lib/schemas/types'
import type { ToolExecutionContext } from '@/lib/chat/tool-executor'
import type { ToolEffect } from '@/lib/tools/effect-types'
import type { buildTools } from '@/lib/services/chat-message/streaming.service'
import type { TextBlockEnabledToolOptions } from '@/lib/services/chat-message/pseudo-tool.service'
import type { AgentInstructionKind } from '@/lib/services/chat-message/agent-mode-resolver.service'

export type ConsoleRepos = ReturnType<typeof getRepositories>

/** What every persona's turn plan carries; a persona may add its own fields. */
/** Why a console run ended with no answer of its own. */
export type ConsoleSalvageCause = 'budget' | 'empty'

export interface ConsoleTurnPlanBase {
  /**
   * The executor's effect ceiling for every tool call of the turn (and the
   * tool list's filter). The guarantee is `resolveToolPermit`; the offer is
   * advice.
   */
  effectCeiling: ToolEffect | undefined
  /** Which agent-mode instructions and forced-final wording the model hears. */
  agentKind: AgentInstructionKind
  /** The stuck-loop nudge's instruction. */
  stuckNudge: string
}

/** The final answer as it is stored. */
export interface ConsoleFinalAnswer {
  content: string
  /** Marks the stored message (and the done frame), e.g. a Writing Assistant output. */
  systemKind?: NonNullable<MessageEvent['systemKind']>
}

export interface ConsolePersona<Plan extends ConsoleTurnPlanBase = ConsoleTurnPlanBase> {
  /** The chat type of the persona's conversations. */
  chatType: ChatType
  /** The persona's name in logs, errors ("Not a … chat") and as the tool executor's speaker. */
  label: string
  /** The surface named in the image-transport budget's log context. */
  surface: string
  /** The folder at the root of Quilltap General holding its attachments. */
  attachmentFolder: string

  /** The model when the conversation pins none (its engine setting). */
  defaultConnectionProfile(repos: ConsoleRepos, userId: string): Promise<ConnectionProfile | null>
  /** The agent-turn budget for one turn. */
  maxAgentTurns(): Promise<number>
  /** Everything that varies within the persona, decided once per turn. */
  planTurn(chat: ChatMetadata): Plan

  /** The tool slate (a `buildTools` call with the persona's flags). */
  buildTools(args: { connectionProfile: ConnectionProfile; userId: string; plan: Plan }): ReturnType<typeof buildTools>
  /** Which text-block tools are described when the model has no native tool calling. */
  textBlockToolOptions(args: { connectionProfile: ConnectionProfile; plan: Plan }): TextBlockEnabledToolOptions
  /**
   * What the tool context carries beyond the engine's own (chat, user, offer,
   * ceiling, plugin effects, turn containers): the surface the tools act for.
   */
  toolContext(plan: Plan): Partial<Pick<ToolExecutionContext, 'operatorSurface'>>

  /** The system prompt, with the engine's tool and agent instructions folded in. */
  buildSystemPrompt(args: {
    repos: ConsoleRepos
    userId: string
    chat: ChatMetadata
    connectionProfile: ConnectionProfile
    toolInstructions: string
    plan: Plan
  }): Promise<string>

  /**
   * The message stored when a run ends with no answer: `cause` is `'budget'`
   * when every turn was spent, `'empty'` when the model answered with nothing
   * before then (most often a reply cut off at its output allowance).
   */
  salvageMessage(args: { maxAgentTurns: number; lastToolResultText: string; plan: Plan; cause: ConsoleSalvageCause }): string
  /** The final answer as stored: `salvaged` when it is the budget notice above. */
  finishAnswer(args: { text: string; salvaged: boolean; plan: Plan }): ConsoleFinalAnswer
}
