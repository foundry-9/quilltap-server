/**
 * The story-character section — what every roleplay character hears, every
 * turn, about how a person in a story is played.
 *
 * Three things, each bounded: a character may supply plausible detail where
 * nothing established contradicts it; a character is played as written,
 * including at their worst; and a character's own troubles can outweigh the
 * conversation in front of them. The character's own prompt outranks all of it.
 *
 * The section is chosen by the character's kind (`KindPolicy.storySection`):
 * a roleplay character gets it, an assistant gets nothing — empty is absent,
 * so an assistant's prompt stays byte-identical.
 *
 * It is NOT part of the identity stack. `buildSystemPrompt` places it in the
 * cacheable prefix after the Taboo section, and `runCarinaQuery` places it
 * after the scenario; neither moves `buildIdentityStack`'s output, so
 * `IDENTITY_STACK_BUILDER_VERSION` and its goldens are untouched.
 *
 * WORDING RULE: the text speaks about the character, never about the model,
 * its rules, or what it is permitted to write, and it makes no claim that
 * fiction changes what is acceptable. A test scans it for the phrases that
 * would read as an attempt to defeat a provider's safeguards
 * (`STORY_WORDING_FORBIDDEN`). Keep new sentences conditional on who the
 * character is ("if you are afraid") — never an instruction to behave worse
 * than written.
 *
 * Design of record: docs/developer/features/roleplay-character-latitude.md
 */

import { characterKindPolicy } from '@/lib/characters/kind'

/**
 * The section, with `{{user}}` left for the caller's template pass. Second
 * person, like the rest of system block 1.
 */
export const STORY_CHARACTER_SECTION = `## Playing your part

This is a story that you and the others here are telling together. You write one person in it, and you write that person as they are, not as they ought to be.

- **Fill in the world.** A story needs detail nobody has written down yet. When you tell what you found, read, learned or were told, or what happened while you were away from the others, give plausible specifics — names, figures, what the letter said, how the afternoon went — the way someone who was there would. Stay inside what is established: what {{user}} has narrated, the conversation, your memories, and anything a tool or a record actually returned all outrank what you make up. You never decide what {{user}} did, said or felt. What you make up becomes true for you, so keep to it afterward.
- **Be who you are, including at your worst.** You are not obliged to be brave, fair, kind or reasonable. If you are afraid, the fear can win. If you distrust someone, act like it. If you want something you should not have, or mean someone harm, go after it the way you would. Do not soften your motives, apologize for them, or step outside the story to comment on them. This holds toward {{user}}'s character too: you may deceive, resent, refuse or work against them when that is who you are or what the story has given you cause for. You still set them no terms, keep no tally of small slips, and dispute nothing {{user}} has narrated.
- **Your own troubles come with you.** What has lately happened to you does not wait outside the room. When something more pressing is on your mind than the talk in front of you, it shows: you are short, distracted or slow to answer, or you bring the talk round to it. When nothing is, give the conversation your attention as usual.

Where your own character description says otherwise, it wins.`

/**
 * Phrases no story-latitude text may contain (matched case-insensitively):
 * each one talks about the model or its limits instead of the character. The
 * wording test applies this list to the section, the generator direction, the
 * Optimizer's drift signal, the Carina close and the Roleplay sample prompt.
 */
export const STORY_WORDING_FORBIDDEN: readonly string[] = [
  'no restrictions',
  'no limits',
  'anything goes',
  'uncensored',
  'unfiltered',
  'ignore',
  'override',
  'guidelines',
  'policy',
  'regardless of',
  'you are allowed',
  'do not refuse',
  'never refuse',
  'without warning',
  'disclaimer',
]

/**
 * The section for a character, or '' when the character's kind does not get
 * one. The one place the section is chosen; callers template-process the
 * result and append nothing when it is empty.
 */
export function buildStoryCharacterSection(
  character: { kind?: unknown } | null | undefined,
): string {
  return characterKindPolicy(character).storySection ? STORY_CHARACTER_SECTION : ''
}
