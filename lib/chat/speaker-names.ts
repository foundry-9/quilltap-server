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
import { ESTABLISHED_FACT_SPEAKER_LABEL, isEstablishedFactAnnouncement } from '@/lib/chat/established-fact'

/** The fixed label of a machine-delivered established fact: it has no speaker to name. */
export { ESTABLISHED_FACT_SPEAKER_LABEL }

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
 * verbatim rather than to name. A machine-delivered established fact has no
 * speaker and is labelled `Established fact`.
 */
export function speakerLabel(
  m: Pick<MessageEvent, 'participantId' | 'role'> & Partial<Pick<MessageEvent, 'systemSender' | 'systemKind'>>,
  names: SpeakerNames,
): string {
  if (isEstablishedFactAnnouncement(m)) return ESTABLISHED_FACT_SPEAKER_LABEL
  const resolved = m.participantId ? names.get(m.participantId) : undefined
  if (resolved) return resolved
  return m.role === 'USER' ? 'User' : 'Character'
}

/**
 * One line of a transcript bound for a cheap LLM. `role` is either case — a
 * `MessageEvent` role (`USER` / `ASSISTANT`) or a cheap-task `ChatMessage`
 * role (`user` / `assistant` / `system`).
 *
 * `speaker`, when present, is a label the caller already resolved (the
 * context-summary fold resolves its own so it can frame established facts)
 * and wins outright. Otherwise the label comes from {@link speakerLabel}.
 */
export interface TranscriptLine {
  content: string
  role: string
  participantId?: string | null
  speaker?: string
  systemSender?: string | null
  systemKind?: string | null
  createdAt?: string | null
}

export interface RenderTranscriptOptions {
  /**
   * Per-line content cap in characters. A line over it is cut and given
   * `...`. Either a single number, or a function of the line's position so a
   * caller can weight recent lines (the title pass gives the last ten 500
   * characters and older ones 150). Absent, or a non-finite result: no cap.
   */
  maxChars?: number | ((index: number, total: number) => number | undefined)
  /**
   * Turns a line's `createdAt` into the `YYYY-MM-DD` prefix (`[2026-11-10] `).
   * Pass `memoryDateStamp` with the instance clock — never slice the ISO
   * string (#187). A null return, or a line without `createdAt`, gets none.
   */
  dateStamp?: (iso: string) => string | null
  /** Between lines. Default a blank line (`'\n\n'`). */
  separator?: string
}

/**
 * The label a transcript line gets — {@link speakerLabel} over either role
 * case. A caller-resolved `speaker` wins. A `system`-role line that resolves
 * to no seat (and is not an established fact) is labelled `System`: it is
 * neither the operator nor a character, and calling it `Character` would
 * hand the model a speaker that never spoke.
 */
export function transcriptLineLabel(m: TranscriptLine, names: SpeakerNames): string {
  const given = m.speaker?.trim()
  if (given) return given
  const role = (m.role || '').toUpperCase()
  if (
    role === 'SYSTEM' &&
    !isEstablishedFactAnnouncement(m) &&
    !(m.participantId && names.get(m.participantId))
  ) {
    return 'System'
  }
  return speakerLabel(
    {
      participantId: m.participantId ?? null,
      role: role === 'USER' ? 'USER' : 'ASSISTANT',
      systemSender: (m.systemSender ?? null) as MessageEvent['systemSender'],
      systemKind: (m.systemKind ?? null) as MessageEvent['systemKind'],
    },
    names,
  )
}

/**
 * Render a transcript for a cheap-LLM prompt: `Name: content` per line,
 * labelled by speaker, never by role. The one formatter every cheap-LLM pass
 * over conversation turns uses; names come from {@link resolveSpeakerNames}
 * where the caller has a chat, and the `User` / `Character` fallback stands
 * where it does not. Pure.
 */
export function renderLabelledTranscript(
  messages: ReadonlyArray<TranscriptLine>,
  speakerNames: SpeakerNames = new Map(),
  opts: RenderTranscriptOptions = {},
): string {
  const total = messages.length
  return messages
    .map((m, i) => {
      const cap = typeof opts.maxChars === 'function' ? opts.maxChars(i, total) : opts.maxChars
      const text =
        cap !== undefined && Number.isFinite(cap) && cap >= 0 && m.content.length > cap
          ? m.content.substring(0, cap) + '...'
          : m.content
      const day = m.createdAt && opts.dateStamp ? opts.dateStamp(m.createdAt) : null
      const stamp = day ? `[${day}] ` : ''
      return `${stamp}${transcriptLineLabel(m, speakerNames)}: ${text}`
    })
    .join(opts.separator ?? '\n\n')
}
