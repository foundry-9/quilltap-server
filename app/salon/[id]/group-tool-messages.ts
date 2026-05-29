import type { Message } from './types'

/**
 * Parse the JSON content of a TOOL message and read its `initiatedBy` field.
 * Returns `undefined` when the content can't be parsed or the field is absent.
 * User-initiated runs (Run Tool modal, composer-attached results) carry
 * `initiatedBy: 'user'`; character-initiated tool results omit it.
 */
function readInitiatedBy(content: string): string | undefined {
  try {
    const parsed = JSON.parse(content) as { initiatedBy?: unknown }
    return typeof parsed.initiatedBy === 'string' ? parsed.initiatedBy : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether an assistant row is a real character turn that can host nested tool
 * calls. Excludes Staff-authored announcements (systemSender), ad-hoc
 * announcer bubbles (customAnnouncer), and Courier placeholders awaiting a
 * pasted reply (pendingExternalPrompt) — none of those "call" tools.
 */
function isCharacterAssistant(message: Message): boolean {
  return (
    message.role === 'ASSISTANT' &&
    !message.systemSender &&
    !message.customAnnouncer &&
    !message.pendingExternalPrompt
  )
}

/**
 * Whether a TOOL row is a character-initiated tool call that should nest into
 * the character's message. User-initiated runs (Prospero / Run Tool modal /
 * composer-attached results) stay standalone, so they are excluded here.
 */
function isCharacterToolMessage(message: Message): boolean {
  if (message.role !== 'TOOL') return false
  if (message.systemSender) return false
  if (readInitiatedBy(message.content) === 'user') return false
  return true
}

/**
 * Fold character-initiated TOOL rows into the nearest preceding character
 * assistant message for rendering. The persistence model writes one assistant
 * message per turn (the accumulated prose) immediately followed by its tool
 * result rows, so the nearest preceding assistant is always the bubble that
 * holds that character's words.
 *
 * Behavior:
 * - Character tool results are attached to `attachedToolMessages` on a
 *   shallow-cloned copy of the host assistant message and removed from the
 *   flat list.
 * - User/Prospero/orphan tool rows (and tool rows with no preceding character
 *   assistant in the current turn) pass through as standalone entries.
 * - Non-tool rows and assistant rows without attached tools pass through by
 *   reference, so `MessageRow`'s memo stays stable for untouched messages.
 *
 * Purely a rendering transform — the underlying messages are untouched.
 */
export function groupToolMessagesIntoAssistants(visible: Message[]): Message[] {
  const result: Message[] = []
  // Index into `result` of the current turn's host character-assistant entry,
  // or -1 when the current turn has no host (e.g. right after a USER message).
  let hostIndex = -1

  for (const message of visible) {
    if (message.role === 'USER') {
      // A user message ends the previous turn; tool rows after it belong to a
      // new turn and must not attach backwards across the boundary.
      hostIndex = -1
      result.push(message)
      continue
    }

    if (hostIndex >= 0 && isCharacterToolMessage(message)) {
      const host = result[hostIndex]
      // Clone the host on first attach so the source message is never mutated.
      if (!host.attachedToolMessages) {
        result[hostIndex] = { ...host, attachedToolMessages: [message] }
      } else {
        host.attachedToolMessages.push(message)
      }
      continue
    }

    if (isCharacterAssistant(message)) {
      hostIndex = result.length
    }
    result.push(message)
  }

  return result
}
