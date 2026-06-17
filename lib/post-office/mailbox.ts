/**
 * The Post Office — mailbox storage layer
 *
 * Thin, mail-specific wrappers over the mount-index document-store service
 * helpers. A character's mailbox is the root-level `Mail/` folder in that
 * character's database-backed vault; one Markdown file per letter, delivery
 * metadata in the frontmatter.
 *
 * These helpers call the service functions directly (not the `doc_*` tool
 * handlers) because both the `send_mail` handler and the Commonplace-time mail
 * check run server-side without the tool-dispatch context. Everything here is
 * a content read/write or a folder ensure — no link/folder GC — so it is safe
 * to run from the forked background-jobs child via the buffered-write path.
 *
 * @module post-office/mailbox
 */

import { createServiceLogger } from '@/lib/logging/create-logger';
import {
  ensureFolderPath,
} from '@/lib/mount-index/folder-paths';
import {
  listDatabaseFiles,
  readDatabaseDocument,
  writeDatabaseDocument,
  DatabaseStoreError,
} from '@/lib/mount-index/database-store';
import {
  parseFrontmatter,
  serializeFrontmatter,
  updateFrontmatterInContent,
} from '@/lib/doc-edit/markdown-parser';
import { formatDateTime } from '@/lib/format-time';

const logger = createServiceLogger('PostOffice:Mailbox');

/** Root-level folder, in every character's vault, where letters are delivered. */
export const MAIL_FOLDER = 'Mail';

/**
 * Frontmatter the delivery system stamps on every letter. The sender never
 * writes any of this — `send_mail`'s `message` is body only.
 */
export interface MailFrontmatter {
  /** Sender character's display name at send time. */
  from: string;
  /** Sender's workspace character id. */
  fromCharacterId: string;
  /** ISO 8601 delivery timestamp. */
  sentAt: string;
  /** Flips true once Suparṇā has announced the letter. */
  alerted: boolean;
  /** Path of the letter being replied to (in the SENDER's mailbox), or null. */
  inReplyTo: string | null;
}

/** A parsed letter: its metadata plus the body the recipient should read. */
export interface ParsedLetter {
  frontmatter: MailFrontmatter;
  body: string;
}

/** Summary of a delivered letter, used by listings and the mail check. */
export interface DeliveredLetterSummary {
  /** The vault-relative path — also the agent-facing message id. */
  path: string;
  from: string;
  sentAt: string;
  body: string;
  alerted: boolean;
  inReplyTo: string | null;
}

export interface DeliverLetterParams {
  recipientVaultId: string;
  /** Sender's display name. */
  fromName: string;
  /** Sender's workspace character id. */
  fromCharacterId: string;
  /** ISO 8601 send time (also the source of the filename's epoch prefix). */
  sentAt: string;
  /** The delivered body (already includes any reply preface). */
  body: string;
  /** Path of the replied-to letter in the sender's mailbox, or null. */
  inReplyTo: string | null;
}

/**
 * Slugify a sender's name for the filename: lowercase, runs of
 * non-alphanumerics collapse to a single hyphen, no leading/trailing hyphen.
 * Mirrors `slugifyWardrobeTitle` in mount-index/character-vault.
 */
export function slugifySenderName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return slug || 'someone';
}

/** Compose the on-disk letter content: frontmatter + a blank line + body. */
export function composeLetterContent(frontmatter: MailFrontmatter, body: string): string {
  return `${serializeFrontmatter(frontmatter as unknown as Record<string, unknown>)}\n${body}`;
}

/** Parse a delivered letter's content into structured metadata + body. */
export function parseLetter(content: string): ParsedLetter {
  const parsed = parseFrontmatter(content);
  const data = parsed.data ?? {};
  const body = content.slice(parsed.bodyStartOffset).replace(/^\n+/, '');
  return {
    frontmatter: {
      from: typeof data.from === 'string' ? data.from : 'Someone',
      fromCharacterId: typeof data.fromCharacterId === 'string' ? data.fromCharacterId : '',
      sentAt: typeof data.sentAt === 'string' ? data.sentAt : '',
      alerted: data.alerted === true,
      inReplyTo: typeof data.inReplyTo === 'string' ? data.inReplyTo : null,
    },
    body,
  };
}

/**
 * Build the quoted reply preface from an original letter's body. Body only —
 * the original's frontmatter is never quoted. Each line is prefixed `> `.
 */
export function buildReplyPreface(originalBody: string, originalSentAt: string): string {
  const when = formatDateTime(originalSentAt, { monthStyle: 'long' }) || 'an earlier date';
  const quoted = originalBody
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
  return `> In reply to your letter of ${when}:\n>\n${quoted}`;
}

/**
 * List the letters (files only) in a vault's `Mail/` folder. Missing or empty
 * folder → `[]`, never an error.
 */
async function listMailEntries(vaultId: string): Promise<string[]> {
  const entries = await listDatabaseFiles(vaultId, { folder: MAIL_FOLDER });
  return entries
    .filter((e) => e.kind !== 'folder' && e.relativePath.toLowerCase().endsWith('.md'))
    .map((e) => e.relativePath);
}

/**
 * Pick a non-colliding `Mail/<epoch>-from-<slug>.md` path. Two letters delivered
 * in the same millisecond from the same sender would otherwise clobber; append a
 * numeric suffix until the name is free.
 */
async function pickFreeMailPath(
  vaultId: string,
  epochMillis: number,
  fromName: string,
): Promise<string> {
  const slug = slugifySenderName(fromName);
  const existing = new Set((await listMailEntries(vaultId)).map((p) => p.toLowerCase()));
  const base = `${MAIL_FOLDER}/${epochMillis}-from-${slug}`;
  let candidate = `${base}.md`;
  let n = 2;
  while (existing.has(candidate.toLowerCase())) {
    candidate = `${base}-${n}.md`;
    n += 1;
  }
  return candidate;
}

/**
 * Deliver a letter into the recipient's `Mail/` folder. Stamps the frontmatter,
 * picks a collision-free path, ensures the folder exists, and writes the file.
 * Returns the delivered vault-relative path.
 */
export async function deliverLetter(params: DeliverLetterParams): Promise<{ path: string }> {
  const { recipientVaultId, fromName, fromCharacterId, sentAt, body, inReplyTo } = params;
  const epochMillis = Number.isFinite(Date.parse(sentAt)) ? Date.parse(sentAt) : 0;

  const frontmatter: MailFrontmatter = {
    from: fromName,
    fromCharacterId,
    sentAt,
    alerted: false,
    inReplyTo,
  };

  const path = await pickFreeMailPath(recipientVaultId, epochMillis, fromName);

  // ensureFolderPath is idempotent (mkdir -p); writeDatabaseDocument also creates
  // parents, but we call it explicitly so the folder row exists even before the
  // first listing.
  await ensureFolderPath(recipientVaultId, MAIL_FOLDER);
  await writeDatabaseDocument(recipientVaultId, path, composeLetterContent(frontmatter, body));

  return { path };
}

/**
 * Read a single letter from a vault by its `Mail/…` path. Returns null if the
 * file is absent (caller decides whether that's an error).
 */
export async function readLetter(vaultId: string, path: string): Promise<ParsedLetter | null> {
  try {
    const { content } = await readDatabaseDocument(vaultId, path);
    return parseLetter(content);
  } catch (err) {
    if (err instanceof DatabaseStoreError && err.code === 'NOT_FOUND') return null;
    throw err;
  }
}

/**
 * Collect every letter in `vaultId`'s mailbox, newest-first. Used by listings.
 */
export async function listMailbox(vaultId: string): Promise<DeliveredLetterSummary[]> {
  const paths = await listMailEntries(vaultId);
  const summaries: DeliveredLetterSummary[] = [];
  for (const path of paths) {
    const letter = await readLetter(vaultId, path);
    if (!letter) continue;
    summaries.push({
      path,
      from: letter.frontmatter.from,
      sentAt: letter.frontmatter.sentAt,
      body: letter.body,
      alerted: letter.frontmatter.alerted,
      inReplyTo: letter.frontmatter.inReplyTo,
    });
  }
  return sortNewestFirst(summaries);
}

/**
 * Collect the letters that have NOT yet been announced by Suparṇā, newest-first.
 * Missing/empty mailbox → `[]`, never an error.
 */
export async function collectUnalertedMail(vaultId: string): Promise<DeliveredLetterSummary[]> {
  const all = await listMailbox(vaultId);
  const unalerted = all.filter((l) => l.alerted !== true);
  return unalerted;
}

/**
 * Flip a letter's `alerted` flag to true (content update; no link/folder GC, so
 * it replays safely from the forked child). No-op + warn if the letter is gone.
 */
export async function markAlerted(vaultId: string, path: string): Promise<void> {
  try {
    const { content } = await readDatabaseDocument(vaultId, path);
    const updated = updateFrontmatterInContent(content, { alerted: true });
    await writeDatabaseDocument(vaultId, path, updated);
  } catch (err) {
    if (err instanceof DatabaseStoreError && err.code === 'NOT_FOUND') {
      logger.warn('markAlerted: letter no longer present', { vaultId, path });
      return;
    }
    throw err;
  }
}

/** Sort summaries newest-first by `sentAt`, falling back to path order. */
function sortNewestFirst(letters: DeliveredLetterSummary[]): DeliveredLetterSummary[] {
  return [...letters].sort((a, b) => {
    const ta = Date.parse(a.sentAt);
    const tb = Date.parse(b.sentAt);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return tb - ta;
    return b.path.localeCompare(a.path);
  });
}
