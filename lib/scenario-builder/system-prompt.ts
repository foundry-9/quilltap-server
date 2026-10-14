/**
 * Scenario Builder — the system prompt and the user message.
 *
 * Both are for a model, not a person, so they are plain and short: no
 * steampunk. The builder prompt never enters a chat's system prompt; the scene
 * it produces enters a chat exactly as a hand-typed custom scenario does.
 *
 * Not user-editable in v1.
 *
 * @module scenario-builder/system-prompt
 */

export type ScenarioBuilderMode = 'real' | 'in-world'

/** Target length stated to the model. The builder never truncates. */
export const SCENARIO_TARGET_TOKENS = 1000

export function buildScenarioBuilderSystemPrompt(opts: {
  mode: ScenarioBuilderMode
  webAvailable: boolean
  toolInstructions: string
  now: Date
}): string {
  const { mode, webAvailable, toolInstructions, now } = opts

  const sections: string[] = []

  sections.push(
    'You are The Host of Quilltap, setting the opening scene for a conversation. Produce ONLY the scene, as Markdown, and deliver it by calling `submit_final_response`. No preamble, no notes, no sources, no title unless the scene itself wants one.',
  )

  sections.push(`## The scene must leave the people out

This is non-negotiable. Never name, count, or describe the people who will be present. Do not use \`{{char}}\`, \`{{user}}\`, or any other placeholder. Write in the present tense, addressed to no one. Describe the place, the time, the weather, the light, the sounds, what is happening around, what has just happened, and what is about to. The stores you read may describe characters; use them for the world only, and leave the people out of the scene.`)

  sections.push(`## Length

Aim for ${SCENARIO_TARGET_TOKENS.toLocaleString('en-US')} tokens or fewer — a paragraph or two is usually right. If the details ask for a particular tone or length, follow them.`)

  if (mode === 'real') {
    const lines = [
      '## Research: a real place',
      '',
      'The location is a real place. Use `search_web` and `curl` to establish what it is actually like: its geography, its period details for the given time, and anything the details ask for. The document stores are open to you too (`search` and the `doc_*` read tools) — check them for anything the user has already written about this place. Cite nothing; write the scene.',
    ]
    if (!webAvailable) {
      lines.push(
        '',
        'The web is unavailable in this run. Rely on what you know; where you are unsure of a fact, keep the scene general rather than invent specifics.',
      )
    }
    sections.push(lines.join('\n'))
  } else {
    sections.push(`## Research: the user's world

The location is fictional and belongs to the user's world. Everything you need is in the document stores: use \`search\` (documents and knowledge) and the \`doc_*\` read tools to find the place, its history, its customs, and what the time means there. Do not invent lore that contradicts what you find; where the stores are silent, stay consistent with their tone. You have no access to the web.`)
  }

  sections.push(`## Now

The current date and time is ${formatIsoWithOffset(now)}. Use it as the reference for "now", "tonight", "this morning", and the like.`)

  if (toolInstructions) {
    sections.push(toolInstructions)
  }

  return sections.join('\n\n')
}

export interface ScenarioBuilderUserMessageInput {
  mode: ScenarioBuilderMode
  location: string
  time: string
  details: string
  /** In-chat only: the scene being replaced. */
  currentScenario?: string | null
  /** In-chat only: the chat's context summary — the "chat" rung of the hierarchy. */
  contextSummary?: string | null
  /** Revise: the draft as currently edited. Travels with `revision`. */
  priorDraft?: string | null
  /** Revise: the instruction. Travels with `priorDraft`. */
  revision?: string | null
}

export function buildScenarioBuilderUserMessage(input: ScenarioBuilderUserMessageInput): string {
  const blocks: string[] = [
    [
      `Mode: ${input.mode}`,
      `Location: ${input.location}`,
      `Time: ${input.time}`,
      `Details: ${input.details.trim() ? input.details.trim() : '(none)'}`,
    ].join('\n'),
  ]

  const currentScenario = input.currentScenario?.trim()
  const contextSummary = input.contextSummary?.trim()
  if (currentScenario) {
    blocks.push(`Current scene (being replaced):\n${currentScenario}`)
  }
  if (contextSummary) {
    blocks.push(
      `Where the conversation stands:\n${contextSummary}\n\n(This summary may name people. The new scene must not.)`,
    )
  }

  if (input.priorDraft != null && input.revision != null) {
    blocks.push(`Current draft:\n${input.priorDraft}`)
    blocks.push(`Revision requested:\n${input.revision}\n\nReturn the whole revised scene.`)
  }

  return blocks.join('\n\n')
}

/** ISO-8601 with the server's local offset, e.g. `2026-09-23T14:05:00-05:00`. */
function formatIsoWithOffset(date: Date): string {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const offset = `${sign}${pad(Math.trunc(offsetMinutes / 60))}:${pad(offsetMinutes % 60)}`
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offset}`
  )
}
