/**
 * Shared save-dispatch for character field updates.
 *
 * Several character fields cannot all ride the same request: the character PUT
 * body (`/api/v1/characters/[id]`) accepts simple scalars, the scenarios array,
 * and the single physicalDescription object, but it *strips* `systemPrompts`
 * (the schema has no such key). System prompts therefore have to persist
 * through their own dedicated endpoints. This helper centralises that fan-out so
 * every caller (the character optimizer's "Refine from Memories" apply step and
 * the view-details `{{char}}`/`{{user}}` template buttons) routes updates the
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
  /** Optional fallback error strings (used only when the server returns none). */
  messages?: {
    promptUpdateFailed?: string
    promptCreateFailed?: (name: string) => string
    mainPutFailed?: string
  }
}

const DEFAULT_MESSAGES = {
  promptUpdateFailed: 'A system prompt could not be saved.',
  promptCreateFailed: (name: string) => `The system prompt "${name}" could not be saved.`,
  mainPutFailed: 'The character could not be updated.',
}

/**
 * Dispatches character field updates across the main PUT and the dedicated
 * system-prompt endpoints. Fires prompt refinements, then prompt creations, then
 * the main PUT (only when there is something to send). Returns the collected
 * error messages (empty array on full success); never rejects on an HTTP error.
 */
export async function applyCharacterFieldUpdates(
  characterId: string,
  updates: CharacterFieldUpdates
): Promise<{ errors: string[] }> {
  const { mainUpdates, promptUpdates = [], promptCreates = [], messages } = updates
  const msg = {
    promptUpdateFailed: messages?.promptUpdateFailed ?? DEFAULT_MESSAGES.promptUpdateFailed,
    promptCreateFailed: messages?.promptCreateFailed ?? DEFAULT_MESSAGES.promptCreateFailed,
    mainPutFailed: messages?.mainPutFailed ?? DEFAULT_MESSAGES.mainPutFailed,
  }
  const errors: string[] = []
  const jsonHeaders = { 'Content-Type': 'application/json' }

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

  return { errors }
}
