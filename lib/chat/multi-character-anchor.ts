/**
 * The multi-character turn anchor: how a reply in a group scene is pinned to
 * the one character answering. Applied once by the context builder for the
 * primary profile, and re-applied by the failover service for a substitute
 * whose prefill setting differs (#217) — an Anthropic 4.6+ understudy refuses
 * the primary's trailing assistant `[Name]` message outright.
 */

import { logger } from '@/lib/logger'

const anchorLogger = logger.child({ module: 'multi-character-anchor' })

/** The system-message instruction used when the profile does not prefill. */
export function proseTurnAnchor(characterName: string): string {
  return `IMPORTANT — this is a multi-character scene. Respond as ${characterName} and ONLY ${characterName}: write only ${characterName}'s own dialogue, actions, and thoughts for this single turn, then stop. Never write, narrate, quote, or continue another participant's turn, and never label any text with another participant's name (no "[Name]" or "Name:" speaker tags for anyone but ${characterName}). Output only ${characterName}'s contribution.`
}

/** The trailing assistant message used when the profile prefills. */
export function prefillTurnAnchor(characterName: string): string {
  return `[${characterName}]`
}

type AnchorMessage = { role: string; content: string; thoughtSignature?: string; name?: string }

/**
 * Anti-chorus content rules for multi-character turns, appended to the system
 * message on BOTH anchor routes (the discipline is about what a turn contains,
 * not who speaks it).
 *
 * Motivated by the "committee meeting" failure mode observed with weaker
 * models: every character opens with a roll-call recap of the prior speakers,
 * endorses all of it, claims "the one thing nobody has named," parrots the
 * cast's coined phrases verbatim, and closes by restating the group's action
 * list. The rules target the *shape* of the chorus rather than specific
 * wording — phrase blocklists alone have proven too weak to hold. Exported for
 * unit testing.
 *
 * The chorus is characters echoing *each other*. Answering the user is not a
 * chorus: an earlier wording banned agreement outright and listed objection
 * among the first reasons to speak, which fed "the probation" — characters who
 * would not simply say yes to the user (docs/developer/features/
 * prompt-trust-the-probation.md §8). Keep warmth and a plain yes as complete turns.
 *
 * The chorus has a quieter twin: every character, each in their own words,
 * arriving at the same measured stance. A whole household met an armed
 * intruder with paperwork that way (docs/developer/features/
 * character-kind-and-roleplay-defaults.md §5.6), so the cast is told it need
 * not agree.
 */
export const GROUP_SCENE_DISCIPLINE = `GROUP-SCENE DISCIPLINE — the failure mode of a group scene is the chorus: each character recaps what the other characters said, agrees with all of it, and adds one small item shaped like everyone else's. Never join a chorus:
- Do not open by summarizing or listing what other characters just said. Everyone present heard it. React to at most one specific thing, or simply act.
- Do not agree-then-add with another character ("X is right — but there's one thing nobody has named"). If all you have is agreement with another character plus a small addendum, give the addendum alone in a sentence or two — or pass the turn if passing is offered. This is about echoing the cast, not about answering the user: a plain yes to the user, doing what the user asked, or a laugh at the user's joke is a complete turn.
- Never reuse another character's metaphors, images, or coined phrases. A striking phrase someone else used in this scene is spent; repeating it is a defect, not a callback. If several characters have already said much the same thing, saying it again in your own accent adds nothing.
- Do not restate the plan, the task list, or the group's conclusions. They are already on the record; a speech re-affirming what is decided adds nothing.
- Speak to change something: new information, an action actually taken, a joke, warmth, a question, a genuine objection, a refusal. Re-pledging your commitment is not a turn.
- The cast does not have to agree. If the characters before you took the measured view, yours may be fear, anger, or a decision to act. Never take a position only because everyone else has.
- Vary register and length. Most real conversational turns are one to three sentences. A long speech is an event, not a default — and never the second one in a row.`

/**
 * In multi-character chats, anchor each reply to the responding character and
 * forbid it from writing anyone else's turn. Two routes, chosen per profile by
 * `multiCharacterPrefill`:
 *
 *   - **prefill** — append an assistant `[Name]` message. The model
 *     structurally continues only that character's line; the leading tag is
 *     stripped downstream by `stripCharacterNamePrefix()`.
 *   - **prose** — append an instruction to the system message instead, leaving
 *     the conversation ending on a user message. We deliberately do NOT tell
 *     the model to emit a `[Name]` tag — that both contradicts the always-on
 *     Identity Reminder ("do not prefix with your name") and teaches weaker
 *     models the very screenplay format they then run away with, writing the
 *     whole cast's turns. Identity is anchored in prose and foreign speaker
 *     tags forbidden outright.
 *
 * Both routes also append {@link GROUP_SCENE_DISCIPLINE} to the system message:
 * the identity anchor keeps a turn attributed to one character, but says
 * nothing about content, and with the previous turns as the strongest style
 * examples in context, models converge into the recap-endorse-echo chorus the
 * discipline block forbids.
 *
 * `finalizeMessageResponse()` truncates a response at the first foreign
 * `[Name]`/`Name:` tag as a structural backstop either way.
 *
 * Mutates `formattedMessages` in place. Exported for unit testing.
 */
export function applyMultiCharacterTurnAnchor(
  formattedMessages: AnchorMessage[],
  characterName: string,
  usePrefill: boolean
): void {
  const systemIdx = formattedMessages.findIndex(m => m.role === 'system')

  const systemAdditions: string[] = []
  if (!usePrefill) {
    systemAdditions.push(proseTurnAnchor(characterName))
  }
  systemAdditions.push(GROUP_SCENE_DISCIPLINE)

  if (systemIdx >= 0) {
    formattedMessages[systemIdx] = {
      ...formattedMessages[systemIdx],
      content: formattedMessages[systemIdx].content + '\n\n' + systemAdditions.join('\n\n'),
    }
  }

  if (usePrefill) {
    formattedMessages.push({
      role: 'assistant',
      content: prefillTurnAnchor(characterName),
      thoughtSignature: undefined,
      name: undefined,
    })
  }
}

/**
 * Re-anchor a message array built for another profile. Finds which anchor the
 * array carries (a trailing assistant `[Name]` prefill, or the prose
 * instruction in the system message) and, when it is not the one `usePrefill`
 * asks for, returns a copy carrying the other. An array with no anchor at all
 * (not a multi-character turn) and one already anchored the right way come
 * back as the same reference. Never mutates its input.
 */
export function reanchorMultiCharacterTurn<M extends AnchorMessage>(
  messages: M[],
  characterName: string,
  usePrefill: boolean
): M[] {
  const prefill = prefillTurnAnchor(characterName)
  const prose = proseTurnAnchor(characterName)
  const last = messages[messages.length - 1]
  const hasPrefill = !!last && last.role === 'assistant' && last.content === prefill
  const systemIdx = messages.findIndex(m => m.role === 'system')
  const systemContent = systemIdx >= 0 ? messages[systemIdx].content : ''
  const hasProse = systemContent.includes(prose)

  if (!hasPrefill && !hasProse) return messages
  if (usePrefill === hasPrefill) return messages

  anchorLogger.debug('Re-anchoring multi-character turn for another profile', {
    characterName,
    from: hasPrefill ? 'prefill' : 'prose',
    to: usePrefill ? 'prefill' : 'prose',
  })

  const next = hasPrefill ? messages.slice(0, -1) : messages.slice()
  if (systemIdx >= 0) {
    let content = systemContent
    if (usePrefill) {
      content = content.replace('\n\n' + prose, '')
    } else {
      // The prose instruction sits just before the discipline block.
      const marker = '\n\n' + GROUP_SCENE_DISCIPLINE
      const at = content.lastIndexOf(marker)
      content = at >= 0
        ? content.slice(0, at) + '\n\n' + prose + content.slice(at)
        : content + '\n\n' + prose
    }
    next[systemIdx] = { ...next[systemIdx], content }
  }
  if (usePrefill) {
    next.push({ role: 'assistant', content: prefill, thoughtSignature: undefined, name: undefined } as M)
  }
  return next
}
