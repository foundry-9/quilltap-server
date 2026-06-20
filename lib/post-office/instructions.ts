/**
 * The Post Office — agent-facing instruction snippets
 *
 * Single source for the literal tool calls we hand a character so it can read,
 * answer, or discard a letter. Reused by `list_email` and by Suparṇā's mail
 * whisper so the two never drift. Mail always lives in the recipient's own
 * vault, so we address it with the canonical `qtap://self/…` URI form.
 *
 * @module post-office/instructions
 */

import { formatSelfUri } from '@/lib/doc-edit/qtap-uri';
import { formatDateTime } from '@/lib/format-time';
import type { DeliveredLetterSummary } from './mailbox';

/** A formatted, indented block of the three actions available on a letter.
 *  The read/discard actions lead with the letter's `qtap://self/…` URI; the
 *  send_mail `in_reply_to` stays the raw letter id (a letter handle, not a
 *  document reference). */
export function formatLetterActions(letter: { path: string; from: string }): string {
  const { path, from } = letter;
  const uri = formatSelfUri(path);
  return [
    `   • Read it again: doc_read_file({ uri: "${uri}" })`,
    `   • Answer it: send_mail({ character: "${from}", message: "…your reply…", in_reply_to: "${path}" })`,
    `   • Discard it: doc_delete_file({ uri: "${uri}" })`,
  ].join('\n');
}

/** A one-line human date for a letter, falling back gracefully. */
export function formatLetterDate(sentAt: string): string {
  return formatDateTime(sentAt, { monthStyle: 'long' }) || 'an unrecorded hour';
}

/** Heading line(s) for a letter in a numbered listing. The locator is the
 *  letter's `qtap://self/…` URI; the raw id (its path) lives in the action
 *  lines' `in_reply_to`. */
export function formatLetterHeading(letter: DeliveredLetterSummary, index: number): string {
  const announced = letter.alerted ? ' (already announced)' : ' (newly arrived)';
  return `${index}. From ${letter.from} — ${formatLetterDate(letter.sentAt)}${announced}\n   ${formatSelfUri(letter.path)}`;
}
