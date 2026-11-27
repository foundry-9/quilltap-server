/**
 * Deleting a character: the one client request (`DELETE /api/v1/characters/[id]`
 * with the cascade choices from `CharacterDeleteDialog`) and the toast text that
 * reports what went with it. Shared by the Aurora shelf and the character page.
 *
 * @module components/characters/delete-character
 */

export interface CharacterDeleteOptions {
  cascadeChats: boolean
  cascadeImages: boolean
}

/** What the DELETE reports it removed alongside the character. */
export interface CharacterDeleteResult {
  deletedChats?: number
  deletedImages?: number
  deletedMemories?: number
}

/**
 * Send the delete. Throws `Error(failureMessage)` on a non-2xx answer; an
 * unreadable success body reads as nothing else removed.
 */
export async function deleteCharacter(
  characterId: string,
  options: CharacterDeleteOptions,
  failureMessage: string,
): Promise<CharacterDeleteResult> {
  const params = new URLSearchParams()
  if (options.cascadeChats) params.set('cascadeChats', 'true')
  if (options.cascadeImages) params.set('cascadeImages', 'true')
  const qs = params.toString()
  const res = await fetch(`/api/v1/characters/${characterId}${qs ? `?${qs}` : ''}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(failureMessage)
  return (await res.json().catch(() => ({}))) as CharacterDeleteResult
}

/** "Name deleted. 2 chats deleted. 1 memory deleted" — only the counts above zero. */
export function deletionSummary(result: CharacterDeleteResult, name: string): string {
  const parts = [`${name} deleted`]
  const chats = result.deletedChats ?? 0
  const images = result.deletedImages ?? 0
  const memories = result.deletedMemories ?? 0
  if (chats > 0) parts.push(`${chats} chat${chats === 1 ? '' : 's'} deleted`)
  if (images > 0) parts.push(`${images} image${images === 1 ? '' : 's'} deleted`)
  if (memories > 0) parts.push(`${memories} memor${memories === 1 ? 'y' : 'ies'} deleted`)
  return parts.join('. ')
}
