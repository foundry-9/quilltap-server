/**
 * Length caps for a character's physical-description prompts, and the one way
 * a generated prompt is brought under them.
 *
 * The caps mirror `PhysicalDescriptionSchema` (`lib/schemas/character.types.ts`).
 * Models routinely overrun a "max N characters" instruction, and a hard
 * `substring(0, N)` used to leave the stored prompt ending mid-word ("Small p").
 * `fitToCharacterLimit` cuts at the last sentence, clause or word boundary that
 * fits instead, so an overrun prompt loses its final descriptor rather than
 * half of it.
 */

export const PHYSICAL_PROMPT_LIMITS = {
  headAndShouldersPrompt: 500,
  shortPrompt: 350,
  mediumPrompt: 500,
  longPrompt: 750,
  completePrompt: 1000,
} as const;

export type PhysicalPromptField = keyof typeof PHYSICAL_PROMPT_LIMITS;

/** Punctuation that may close a trimmed prompt without looking cut off. */
const SENTENCE_END = /[.!?]["')\]]?$/;

/**
 * Bring `text` to at most `max` characters, cutting at a natural boundary.
 *
 * Preference, within the last 40% of the allowance: a sentence end, then a
 * clause break (`,` `;` `:`, with the dangling punctuation dropped), then a
 * word break. Only text with no usable boundary at all is cut hard. Text that
 * already fits is returned trimmed and otherwise untouched.
 */
export function fitToCharacterLimit(text: string | null | undefined, max: number): string {
  const trimmed = (text ?? '').trim();
  if (trimmed.length <= max) return trimmed;

  const window = trimmed.slice(0, max);
  const floor = Math.floor(max * 0.6);

  // Sentence end: the last ". " (or end-quoted variant) inside the window.
  for (let i = window.length - 1; i >= floor; i--) {
    if (/\s/.test(trimmed[i + 1] ?? ' ') && SENTENCE_END.test(window.slice(0, i + 1))) {
      return window.slice(0, i + 1).trim();
    }
  }

  // Clause break: keep everything before the last , ; or :
  const clause = Math.max(window.lastIndexOf(','), window.lastIndexOf(';'), window.lastIndexOf(':'));
  if (clause >= floor) {
    return window.slice(0, clause).trim();
  }

  // Word break.
  const space = window.lastIndexOf(' ');
  if (space >= floor) {
    return window.slice(0, space).replace(/[,;:\s]+$/, '').trim();
  }

  return window.trim();
}

/** Fit one physical-description prompt to its field's cap. */
export function fitPhysicalPrompt(field: PhysicalPromptField, text: string | null | undefined): string {
  return fitToCharacterLimit(text, PHYSICAL_PROMPT_LIMITS[field]);
}
