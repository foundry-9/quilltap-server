/**
 * Atlas lore draft — Brahma's system prompt and the user message.
 *
 * Both are for a model, not a person, so they are plain: no steampunk. The
 * draft comes back as the shape an Atlas file has on disk — YAML frontmatter
 * (`name`, `aliases`, `graphicPrompt`) over a Markdown body (the knowledge) —
 * and is read by `parseAtlasLoreDraft` (`./parse.ts`). Nothing here writes:
 * the operator reviews the draft in the Atlas editor and saves it there.
 *
 * Not user-editable.
 *
 * @module atlas/lore-draft/prompt
 */

import { ATLAS_GRAPHIC_PROMPT_SOFT_LIMIT } from '@/lib/schemas/atlas.types'
import type { AtlasLoreDraft } from './request-schema'

/** How many existing names the user message lists, at most. */
export const ATLAS_LORE_MAX_LISTED_NAMES = 200

export function buildAtlasLoreSystemPrompt(opts: {
  searchStores: boolean
  /** Brahma's read-only SQL section, included when the stores are open. */
  sqlPrompt?: string | null
  toolInstructions: string
}): string {
  const { searchStores, sqlPrompt, toolInstructions } = opts
  const sections: string[] = []

  sections.push(
    'You are Brahma, the console of Quilltap, a self-hosted workspace for writers and worldbuilders. You have no persona; work plainly. Your task is to draft one entry for the Atlas — the register of the named things in a story that are not people: a vehicle, a house, a ship, a device, a place, an institution, a weapon, a book. Deliver the draft by calling `submit_final_response`. The operator reviews it before anything is saved.',
  )

  sections.push(`## What an Atlas entry is

- **name** — the canonical name the thing is usually called by in the story ("the Convertible", "Blackmoor Hall"). Prefer the form the sources use most. Never a person's name.
- **aliases** — other words or names the thing answers to in the sources ("the roadster", "the Hall"). Each alias is matched as a whole word in conversation, so leave out words so common they would match everything (no "car", "house", "it"), and never use a person's name. Plurals only if the sources use them. An empty list is fine.
- **graphicPrompt** — what the thing looks like, for an image model, in one or two sentences of concrete visual detail: shape, colour, materials, condition, period, distinguishing marks. Keep it under ${ATLAS_GRAPHIC_PROMPT_SOFT_LIMIT} characters, spaces included — image models skim anything longer. No people in it, no story, no style instructions. If the sources say nothing about its appearance and you would have to invent everything, leave it empty.
- **knowledge** — what is known of the thing, in Markdown: what it is, its history, who owns or uses it, where it is, what it does, how people regard it, anything a character in the story could know or might be told. Write it as reference notes about the thing, in the third person, compact and factual — a short paragraph or a few bullet points per topic. A few hundred words is usually right; follow the operator's details if they ask for more or less.`)

  if (searchStores) {
    sections.push(`## Research

Everything you need is in the operator's own material. Before you write, look:

- \`search\` (documents and knowledge) for the subject's name and any likely variants, then open the most promising documents with the \`doc_*\` read tools.
- The lookup shortcuts and \`run_sql\` for anything recorded in the database — characters who own or use the thing, conversations in which it appears.

Search more than once if the first search is thin. Write only what the sources support; where they are silent, leave the gap rather than invent. If the operator's details add facts, take them as true. If you find nothing at all, draft the entry from the subject and the details alone, and say so in the knowledge in one line at the end ("Nothing further was found in the stores.").`)
  } else {
    sections.push(`## Research

You have no tools for this run but \`submit_final_response\`. Draft the entry from the subject and the operator's details alone. If the subject is a real thing you know, you may use what is generally known of it; otherwise write only what the details support and invent nothing.`)
  }

  sections.push(`## Output

Your final response is exactly one document in this shape, and nothing else — no preamble, no code fence, no sources list:

---
name: The canonical name
aliases:
  - first alias
  - second alias
graphicPrompt: One or two sentences of what it looks like.
---
The knowledge, in Markdown.

Quote a frontmatter value in double quotes if it contains a colon. Do not use headings above level 2 in the knowledge.`)

  if (searchStores && sqlPrompt?.trim()) {
    sections.push(sqlPrompt.trim())
  }

  if (toolInstructions) {
    sections.push(toolInstructions)
  }

  return sections.join('\n\n')
}

export interface AtlasLoreUserMessageInput {
  subject: string
  details: string
  /** A label for the tier the entry will be filed in ("Quilltap General", "Project: Ashfall"). */
  targetLabel: string
  /** Names and aliases already filed in that tier: the new entry must not take one. */
  takenNames: readonly string[]
  /** Revise: the draft as currently edited. Travels with `revision`. */
  priorDraft?: AtlasLoreDraft | null
  /** Revise: the instruction. Travels with `priorDraft`. */
  revision?: string | null
}

export function buildAtlasLoreUserMessage(input: AtlasLoreUserMessageInput): string {
  const blocks: string[] = [
    [
      `Subject: ${input.subject.trim()}`,
      `Filed in: ${input.targetLabel}`,
      `Details from the operator: ${input.details.trim() ? input.details.trim() : '(none)'}`,
    ].join('\n'),
  ]

  const taken = input.takenNames.map((n) => n.trim()).filter(Boolean)
  if (taken.length > 0) {
    const listed = taken.slice(0, ATLAS_LORE_MAX_LISTED_NAMES)
    const more = taken.length - listed.length
    blocks.push(
      `Names and aliases already used by other entries there (the new entry's name must not be one of these; avoid them as aliases too):\n${listed.join('; ')}${more > 0 ? `; and ${more} more` : ''}`,
    )
  }

  if (input.priorDraft != null && input.revision != null) {
    blocks.push(`Current draft:\n${renderAtlasLoreDraft(input.priorDraft)}`)
    blocks.push(`Revision requested:\n${input.revision}\n\nReturn the whole revised entry, in the same shape.`)
  }

  return blocks.join('\n\n')
}

/** A draft in the output shape — how a revision shows Brahma the current draft. */
export function renderAtlasLoreDraft(draft: AtlasLoreDraft): string {
  const lines = ['---', `name: ${JSON.stringify(draft.name)}`]
  if (draft.aliases.length > 0) {
    lines.push('aliases:')
    for (const alias of draft.aliases) lines.push(`  - ${JSON.stringify(alias)}`)
  } else {
    lines.push('aliases: []')
  }
  lines.push(`graphicPrompt: ${draft.graphicPrompt?.trim() ? JSON.stringify(draft.graphicPrompt.trim()) : '""'}`)
  lines.push('---')
  lines.push(draft.knowledge?.trim() ?? '')
  return lines.join('\n')
}
