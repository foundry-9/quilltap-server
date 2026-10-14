/**
 * Which system prompt does a character start with?
 *
 * The answer is recorded twice — the character's `defaultSystemPromptId`
 * column and the `isDefault` flag on the prompt itself — and it was resolved
 * by hand at five call sites, three of them disagreeing about what to do when
 * the column named a prompt the character no longer had. Two quietly gave up
 * and started the chat with no prompt at all.
 *
 * One order, stated once: the column when it names a prompt that exists, then
 * the flag, then the first prompt. Structurally typed and free of imports, so
 * the client picker and the server's chat initializer can share it.
 *
 * The write side of the same fact is `CharactersRepository.setDefaultSystemPrompt`.
 */

interface DefaultablePrompt {
  id: string
  isDefault?: boolean
}

interface HasSystemPrompts<P extends DefaultablePrompt> {
  systemPrompts?: P[] | null
  defaultSystemPromptId?: string | null
}

/** The prompt a character starts with, or null when they have none at all. */
export function resolveDefaultSystemPrompt<P extends DefaultablePrompt>(
  character: HasSystemPrompts<P>
): P | null {
  const prompts = character.systemPrompts ?? []
  if (prompts.length === 0) return null

  if (character.defaultSystemPromptId) {
    const named = prompts.find((p) => p.id === character.defaultSystemPromptId)
    if (named) return named
  }

  return prompts.find((p) => p.isDefault) ?? prompts[0] ?? null
}

/** The id of {@link resolveDefaultSystemPrompt}, for the pickers that store one. */
export function resolveDefaultSystemPromptId<P extends DefaultablePrompt>(
  character: HasSystemPrompts<P>
): string | null {
  return resolveDefaultSystemPrompt(character)?.id ?? null
}
