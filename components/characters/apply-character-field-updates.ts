/**
 * Shared save-dispatch for character field updates.
 *
 * A character's fields do not all ride one request: the character PUT body
 * (`/api/v1/characters/[id]`) takes the scalars and the physical description,
 * and refuses the sub-collections — system prompts and scenarios are written
 * one item at a time through their own routes, so a save never re-sends (and
 * never un-archives) the items it did not touch. This helper is the one
 * client fan-out: the main PUT, then the per-item prompt and scenario calls.
 * Every caller (the character optimizer's apply step, the view-details
 * `{{char}}`/`{{user}}` template buttons, the AI Wizard) routes updates the
 * same way with consistent partial-failure handling.
 *
 * It never throws on an HTTP failure — failures are collected and returned so
 * the caller can decide how to surface a partial apply (there is no transaction
 * across endpoints, and each write is idempotent, so a re-run is safe).
 */

export interface CharacterFieldUpdates {
  /** Fields that map onto the main `PUT /api/v1/characters/[id]` body. */
  mainUpdates: Record<string, unknown>
  /** Existing system prompts to refine via `PUT .../prompts/[id]`. */
  promptUpdates?: Array<{ id: string; content: string }>
  /** New system prompts to create via `POST .../prompts`. */
  promptCreates?: Array<{ name: string; content: string }>
  /** Existing scenarios to change via `PUT .../scenarios?scenarioId=` — only the fields named. */
  scenarioUpdates?: Array<{ id: string; title?: string; content?: string; description?: string }>
  /** Optional fallback error strings (used only when the server returns none). */
  messages?: {
    promptUpdateFailed?: string
    promptCreateFailed?: (name: string) => string
    scenarioUpdateFailed?: string
    mainPutFailed?: string
  }
}

const DEFAULT_MESSAGES = {
  promptUpdateFailed: 'A system prompt could not be saved.',
  promptCreateFailed: (name: string) => `The system prompt "${name}" could not be saved.`,
  scenarioUpdateFailed: 'A scenario could not be saved.',
  mainPutFailed: 'The character could not be updated.',
}

/**
 * Dispatches character field updates: the main PUT (only when there is
 * something to send), then prompt refinements, prompt creations and scenario
 * changes, one item each. Returns the collected error messages (empty array on
 * full success); never rejects on an HTTP error.
 */
export async function applyCharacterFieldUpdates(
  characterId: string,
  updates: CharacterFieldUpdates
): Promise<{ errors: string[] }> {
  const { mainUpdates, promptUpdates = [], promptCreates = [], scenarioUpdates = [], messages } = updates
  const msg = {
    promptUpdateFailed: messages?.promptUpdateFailed ?? DEFAULT_MESSAGES.promptUpdateFailed,
    promptCreateFailed: messages?.promptCreateFailed ?? DEFAULT_MESSAGES.promptCreateFailed,
    scenarioUpdateFailed: messages?.scenarioUpdateFailed ?? DEFAULT_MESSAGES.scenarioUpdateFailed,
    mainPutFailed: messages?.mainPutFailed ?? DEFAULT_MESSAGES.mainPutFailed,
  }
  const errors: string[] = []
  const jsonHeaders = { 'Content-Type': 'application/json' }

  // Everything that rides the PUT body (only fire if there is something to send).
  if (Object.keys(mainUpdates).length > 0) {
    const res = await fetch(`/api/v1/characters/${characterId}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(mainUpdates),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      errors.push((data.error as string | undefined) ?? msg.mainPutFailed)
    }
  }

  // System-prompt refinements: dedicated PUT per prompt.
  for (const { id, content } of promptUpdates) {
    const res = await fetch(`/api/v1/characters/${characterId}/prompts/${id}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ content }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      errors.push((data.error as string | undefined) ?? msg.promptUpdateFailed)
    }
  }

  // New system prompts: dedicated POST, named as provided.
  for (const { name, content } of promptCreates) {
    const res = await fetch(`/api/v1/characters/${characterId}/prompts`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ name, content }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      errors.push((data.error as string | undefined) ?? msg.promptCreateFailed(name))
    }
  }

  // Scenario changes: one item each, naming only what changed, so an archived
  // flag or a description the caller never saw cannot be lost.
  for (const { id, ...fields } of scenarioUpdates) {
    const res = await fetch(`/api/v1/characters/${characterId}/scenarios?scenarioId=${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(fields),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      errors.push((data.error as string | undefined) ?? msg.scenarioUpdateFailed)
    }
  }

  return { errors }
}
