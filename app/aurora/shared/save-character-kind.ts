/**
 * Persist a character's kind (roleplay / assistant), stored in the vault's
 * `properties.json`, with an immediate PUT. Shared by the character detail
 * and edit views; each owns its own optimistic local update and rolls it back
 * (re-fetches) when this throws.
 */

import { showSuccessToast } from '@/lib/toast'
import type { CharacterKind } from '@/lib/characters/kind'

const SUCCESS_MESSAGES: Record<CharacterKind, string> = {
  roleplay: 'Very good — this character takes the stage as a player in the drama',
  assistant: 'Very good — this character joins the staff as an assistant',
}

export async function saveCharacterKind(characterId: string, kind: CharacterKind): Promise<void> {
  const res = await fetch(`/api/v1/characters/${characterId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind }),
  })
  if (!res.ok) throw new Error('Failed to update the kind of character')
  showSuccessToast(SUCCESS_MESSAGES[kind])
}
