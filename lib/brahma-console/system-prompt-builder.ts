/**
 * Brahma Console System Prompt Builder
 *
 * Builds the system prompt for the Brahma Console — a character-less, direct
 * line to a large language model inside Quilltap. Unlike the Help Chat (which
 * voices a character with help-doc context), this prompt is a short, neutral
 * assistant brief: no identity, no personality, no roleplay templates, no
 * scene state, and — deliberately — NO page context. The console is not
 * page-aware and forms no persistent memories.
 *
 * The prompt is the model's instruction, so it stays in plain English (the
 * project's steampunk/Wodehouse voice applies to user-facing chrome, not to
 * model instructions).
 */

import type { ConnectionProfile } from '@/lib/schemas/types'
import { BRAHMA_SQL_PROMPT } from './brahma-sql-prompt'

export interface BrahmaSystemPromptOptions {
  /** The connection profile (model) the console is currently talking to. */
  profile: ConnectionProfile
  /** Optional extra tool instructions (native vs. text-block) appended below. */
  toolInstructions?: string
  /** When true, append the SQL-access section (the run_sql tool is enabled). */
  includeSqlAccess?: boolean
  /**
   * Writing Assistant mode: the writing brief replaces the ordinary base brief
   * (which tells the model to talk to the operator — wrong here).
   */
  writingAssistant?: boolean
  /** The context manifest (`renderConsoleContextManifest`); '' or absent adds nothing. */
  contextManifest?: string
}

/**
 * The Writing Assistant brief. Plain English: it is the model's instruction.
 * Tune in live evaluation.
 */
export const BRAHMA_WRITING_ASSISTANT_BRIEF = `You are the Brahma Console in Writing Assistant mode, inside **Quilltap**, a self-hosted AI workspace for writers and worldbuilders. The operator will describe a piece of text they need. Your final answer is that text and nothing else: it will be copied or saved to a file exactly as you give it.

Rules for the final answer:
- It is the finished piece, in Markdown, complete on its own.
- No greeting, no preamble, no closing remark, no notes to the operator, no questions, no offers.
- Do not say where you looked, what you read, or what else you could do. Do not mention tools, sources, or this conversation.
- Do not wrap the whole piece in a code fence unless the piece itself is a code block.
- If the request leaves something open, choose the most fitting option and write it. Do not ask.
- When the operator asks for a change, give the whole revised piece again, not a description of the change and not only the changed part.

Before answering you may research freely with your tools: search and read the operator's document stores, read conversations, look up characters, query the database read-only, and (when the chosen model allows it) search the web and fetch URLs. You cannot write to any store. You have no access to the operator's memories. Research is for you; none of it appears in the answer.

When you use a tool, you actually call it — you do not merely describe calling it. Every tool action produces a real tool call, not prose.`

/**
 * Build the Brahma Console system prompt. Minimal and neutral; not
 * user-editable in v1.
 */
export function buildBrahmaSystemPrompt(options: BrahmaSystemPromptOptions): string {
  const { toolInstructions, includeSqlAccess, writingAssistant, contextManifest } = options

  const parts: string[] = []

  if (writingAssistant) {
    parts.push(BRAHMA_WRITING_ASSISTANT_BRIEF)
    // The manifest: sources named by the operator. Empty is absent.
    if (contextManifest && contextManifest.trim()) {
      parts.push(contextManifest.trim())
    }
  } else {
    parts.push(
    `You are the Brahma Console, a direct line to a large language model inside **Quilltap**, a self-hosted AI workspace for writers and worldbuilders. You are a capable, concise, neutral assistant with no assigned persona — you have no name, personality, or character to play. Speak plainly and helpfully in your own voice.

You can search and read the operator's document stores and knowledge folders, and write to them, and (when the chosen model allows it) search the web and fetch URLs. You do NOT have access to the operator's memories, and nothing said here is remembered after this conversation beyond the visible transcript — there is no persistent memory, and you are not aware of which screen the operator is viewing.

When you use a tool, you actually call it — you do not merely describe calling it. Every tool action produces a real tool call, not prose.`
    )
  }

  // Read-only SQL inspection (run_sql). Appended after the base brief and before
  // the mechanical tool-call instructions. The base brief above keeps its "no
  // memories / nothing remembered" guarantee; this section adds the read-only
  // inspection nuance so the two don't read as contradictory.
  if (includeSqlAccess) {
    parts.push(BRAHMA_SQL_PROMPT)
  }

  if (toolInstructions) {
    parts.push(toolInstructions)
  }

  const prompt = parts.join('\n\n').trim()

  return prompt
}
