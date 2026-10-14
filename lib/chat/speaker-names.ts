/**
 * Speaker names for transcripts handed to a cheap LLM.
 *
 * A transcript labelled `USER:` / `ASSISTANT:` tells a model which side of the
 * wire a line came from and nothing about who said it. Ask that model for a
 * summary "in character names" and it will supply one — inventing a name for
 * any speaker the dialogue never happens to address by name, then carrying the
 * invention forward through every later fold (bug 161).
 *
 * This module is the one place a `participantId` becomes a display name. The
 * episode pass had a private copy of it and got the right answer; the context
 * summary had none and got "Vivienne". Two implementations of the same map is
 * how that happened, so there is now one.
 *
 * Reads are raw (`findByIdRaw`) so a character whose vault is unavailable
 * degrades to a role label rather than throwing into a best-effort pass.
 *
 * @module chat/speaker-names
 */

import { getRepositories } from '@/lib/repositories/factory'
import type { ChatMetadata, MessageEvent } from '@/lib/schemas/types'

/** participantId → display name. Seats with no resolvable name are absent. */
export type SpeakerNames = ReadonlyMap<string, string>

/** The minimum of a chat this resolver needs: its seats, removed ones included. */
export type SpeakerNamesChat = Pick<ChatMetadata, 'participants'>

/**
 * Resolve every seat in a chat to its character's name.
 *
 * Iterates **all** participants — removed and silent ones included — because a
 * message from a seat that has since left the chat still deserves its name. The
 * user's own seat is an ordinary `CHARACTER` participant with a `characterId`,
 * so the persona resolves exactly the way an LLM seat does; there is no special
 * case for it.
 *
 * Never throws: a failed character read simply leaves the seat unnamed, and
 * {@link speakerLabel} falls back to a role label.
 */
export async function resolveSpeakerNames(chat: SpeakerNamesChat): Promise<SpeakerNames> {
  const names = new Map<string, string>()
  const repos = getRepositories()

  for (const p of chat.participants) {
    if (!p.characterId || names.has(p.id)) continue
    try {
      const character = await repos.characters.findByIdRaw(p.characterId)
      if (character?.name) names.set(p.id, character.name)
    } catch {
      // Name stays role-labelled. A broken vault costs a label, not a fold.
    }
  }

  return names
}

/**
 * The label a transcript line gets. Never a bare LLM role: an unresolvable
 * seat becomes `User` or `Character`, which the fold prompt is told to keep
 * verbatim rather than to name.
 */
export function speakerLabel(
  m: Pick<MessageEvent, 'participantId' | 'role'>,
  names: SpeakerNames,
): string {
  const resolved = m.participantId ? names.get(m.participantId) : undefined
  if (resolved) return resolved
  return m.role === 'USER' ? 'User' : 'Character'
}
