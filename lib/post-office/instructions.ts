/**
 * The Post Office — agent-facing instruction snippets
 *
 * Single source for the literal tool calls we hand a character so it can read,
 * answer, or discard a letter. Reused by `list_mail`, `read_mail` and by
 * Suparṇā's mail whisper so they never drift. A letter is named to the Post
 * Office tools by its bare file name — `read_mail` and `send_mail` put the
 * `Mail/` folder on it themselves, and reach the caller's own mailbox whether
 * or not the character may otherwise see its own vault.
 *
 * @module post-office/instructions
 */

import { formatDateTime } from '@/lib/format-time';
import { letterFileName, type DeliveredLetterSummary } from './mailbox';

export interface LetterActionOptions {
  /** Include the "Read it again" line (omitted when the letter was just read). */
  includeRead?: boolean;
}

/** A formatted, indented block of the actions available on a letter. */
export function formatLetterActions(
  letter: { path: string; from: string },
  options: LetterActionOptions = {},
): string {
  const { path, from } = letter;
  const name = letterFileName(path);
  const lines: string[] = [];
  if (options.includeRead !== false) {
    lines.push(`   • Read it again: read_mail({ letter: "${name}" })`);
  }
  lines.push(
    `   • Answer it: send_mail({ character: "${from}", message: "…your reply…", in_reply_to: "${name}" })`,
    `   • Discard it: discard_mail({ letter: "${name}" })`,
  );
  return lines.join('\n');
}

/** A one-line human date for a letter, falling back gracefully. */
export function formatLetterDate(sentAt: string): string {
  return formatDateTime(sentAt, { monthStyle: 'long' }) || 'an unrecorded hour';
}

/** Heading line(s) for a letter in a numbered listing, naming the letter by
 *  its file name — the handle `read_mail` and `in_reply_to` take. */
export function formatLetterHeading(letter: DeliveredLetterSummary, index: number): string {
  const announced = letter.alerted ? ' (already announced)' : ' (newly arrived)';
  return `${index}. From ${letter.from} — ${formatLetterDate(letter.sentAt)}${announced}\n   Letter: ${letterFileName(letter.path)}`;
}
