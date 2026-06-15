/**
 * The Post Office — shared letter-delivery service
 *
 * The single composition + delivery path used by BOTH the `send_mail` tool
 * handler (a character posting mail) and the Salon "Compose Mail" chat action
 * (the operator posting a letter as one of their player-characters). Keeping it
 * here means the tool and the UI stay in lockstep: identical vault provisioning,
 * identical `in_reply_to` quoting rules, identical filename/frontmatter stamping.
 *
 * Everything here is content read/write + folder ensure (no link/folder GC), so
 * it is safe to run from the forked background-jobs child via the buffered-write
 * path — same guarantee the mailbox storage layer carries.
 *
 * @module post-office/deliver
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import { ensureCharacterVault } from '@/lib/mount-index/character-vault';
import type { Character } from '@/lib/schemas/character.types';
import {
  MAIL_FOLDER,
  deliverLetter,
  readLetter,
  buildReplyPreface,
  type ParsedLetter,
} from './mailbox';

const logger = createServiceLogger('PostOffice:Deliver');

export interface ComposeAndDeliverParams {
  /** The character signing the letter (sender). */
  sender: Character;
  /** The recipient character. */
  recipient: Character;
  /** Body markdown the sender wrote — never includes frontmatter. */
  message: string;
  /**
   * Optional `Mail/…` path of a letter in the SENDER's own mailbox being
   * replied to. When given, the delivered body is prefaced with a quoted copy.
   */
  inReplyTo?: string | null;
}

export type ComposeAndDeliverResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'reply-not-found' };

/**
 * Compose and deliver a letter into the recipient's `Mail/` folder, applying the
 * reply-quoting rules when `inReplyTo` is given. Returns the delivered
 * vault-relative path on success, or a structured failure the caller surfaces in
 * its own voice.
 *
 * No "Sent" copy is written into the sender's vault — by design a character
 * replies to letters it RECEIVED (which sit in its own mailbox), not to letters
 * it sent.
 */
export async function composeAndDeliverLetter(
  params: ComposeAndDeliverParams,
): Promise<ComposeAndDeliverResult> {
  const { sender, recipient, message } = params;
  const inReplyTo = params.inReplyTo ?? null;

  // Ensure both vaults (idempotent). Use the returned ids — the raw rows may
  // carry a stale/null FK before provisioning.
  const { mountPointId: senderVaultId } = await ensureCharacterVault(sender);
  const { mountPointId: recipientVaultId } = await ensureCharacterVault(recipient);

  let body = message;
  if (inReplyTo) {
    const original = await resolveReplyInSenderMailbox(senderVaultId, inReplyTo);
    if (!original) {
      logger.debug('Reply target not in sender mailbox', { senderVaultId, inReplyTo });
      return { ok: false, reason: 'reply-not-found' };
    }
    const preface = buildReplyPreface(original.body, original.frontmatter.sentAt);
    body = `${preface}\n\n${message}`;
  }

  const sentAt = new Date().toISOString();
  const { path } = await deliverLetter({
    recipientVaultId,
    fromName: sender.name,
    fromCharacterId: sender.id,
    sentAt,
    body,
    inReplyTo,
  });

  logger.debug('Letter composed and delivered', {
    fromCharacterId: sender.id,
    toCharacterId: recipient.id,
    recipientVaultId,
    path,
    isReply: Boolean(inReplyTo),
  });

  return { ok: true, path };
}

/**
 * Resolve an `in_reply_to` reference: it must be a `Mail/…` path that exists in
 * the SENDER's own mailbox. Returns the parsed original, or null when the path
 * is outside `Mail/` or no such letter exists.
 */
export async function resolveReplyInSenderMailbox(
  senderVaultId: string,
  inReplyTo: string,
): Promise<ParsedLetter | null> {
  const normalized = inReplyTo.replace(/^\/+/, '');
  const prefix = `${MAIL_FOLDER}/`;
  if (!normalized.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  return readLetter(senderVaultId, normalized);
}
