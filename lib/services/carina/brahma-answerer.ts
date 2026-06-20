/**
 * The Brahma Console as a Carina answerer ("Brahma").
 *
 * The Brahma Console (a character-less, memory-free, SQL-capable direct line to
 * a plain LLM — see `lib/services/brahma-console/`) is reachable from inside a
 * Salon through the ordinary Carina plumbing, by the name "Brahma". It is a
 * PSEUDOCHARACTER: it has no `characters` row, forms no memories, and never
 * appears in any character list. A Brahma reference answer is posted as a normal
 * `systemSender: 'carina'` message whose `carinaMeta.answererId` is the reserved
 * sentinel below, so it inherits Carina's memory-suppression and reference-card
 * rendering without a new `systemSender` value.
 *
 * Authorization (operator / user-controlled persona / `systemTransparency`
 * characters only) lives in `carina.service.ts`; the one-shot answer engine
 * lives in `lib/services/brahma-console/one-shot.service.ts`.
 */

/**
 * Reserved `carinaMeta.answererId` for Brahma Console answers. A fixed RFC-4122
 * v4 UUID (valid for `z.uuid()`), chosen so it can never collide with a real
 * `character.id`. NOT the nil UUID. The Salon renderer and the chat `get`
 * handler special-case this id; the "prior Carina exchanges" loader never
 * matches it (no real answerer carries it), so Brahma queries stay standalone.
 */
export const BRAHMA_CARINA_ANSWERER_ID = 'b4a4c0de-0000-4000-8000-000000000001';

/** True when a requested Carina answerer name refers to the Brahma Console. */
export function isBrahmaName(name: string): boolean {
  return name.trim().toLowerCase() === 'brahma';
}
