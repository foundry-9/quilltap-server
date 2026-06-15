/**
 * The Post Office — agent-facing instruction snippets
 *
 * Single source for the literal tool calls we hand a character so it can read,
 * answer, or discard a letter. Reused by `list_email` and by Suparṇā's mail
 * whisper so the two never drift. The own-vault `mount_point` is the resolver's
 * reserved self-token, imported (not retyped) so it stays in lockstep.
 *
 * @module post-office/instructions
 */

import { SELF_VAULT_TOKEN } from '@/lib/doc-edit/path-resolver';
import { formatDateTime } from '@/lib/format-time';
import type { DeliveredLetterSummary } from './mailbox';

/** A formatted, indented block of the three actions available on a letter. */
export function formatLetterActions(letter: { path: string; from: string }): string {
  const { path, from } = letter;
  return [
    `   • Read it again: doc_read_file({ scope: "document_store", mount_point: "${SELF_VAULT_TOKEN}", path: "${path}" })`,
    `   • Answer it: send_mail({ character: "${from}", message: "…your reply…", in_reply_to: "${path}" })`,
    `   • Discard it: doc_delete_file({ scope: "document_store", mount_point: "${SELF_VAULT_TOKEN}", path: "${path}" })`,
  ].join('\n');
}

/** A one-line human date for a letter, falling back gracefully. */
export function formatLetterDate(sentAt: string): string {
  return formatDateTime(sentAt, { monthStyle: 'long' }) || 'an unrecorded hour';
}

/** Heading line(s) for a letter in a numbered listing. */
export function formatLetterHeading(letter: DeliveredLetterSummary, index: number): string {
  const announced = letter.alerted ? ' (already announced)' : ' (newly arrived)';
  return `${index}. From ${letter.from} — ${formatLetterDate(letter.sentAt)}${announced}\n   id: ${letter.path}`;
}
