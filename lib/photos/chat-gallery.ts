/**
 * The chat gallery enumerator — every image that exists in one conversation.
 *
 * A Salon conversation accumulates pictures from many directions, and each
 * direction records its picture somewhere different: an upload lands in
 * `files.linkedTo`, an `attach_image` re-show lands only in a message's
 * `attachments`, a Lantern backdrop lands in `files.linkedTo` *and*
 * `chats.storyBackgroundImageId` (and usually posts no message at all), a
 * participant's standing portrait lands in `characters.defaultImageId` and is
 * never tied to a chat in any way. There is no single table to read.
 *
 * This module is the single place that knows all nine of them. Nothing else —
 * not the `/chats/[id]/files` listing, not the sidebar count, not the gallery
 * modal — re-derives "which images are in this chat".
 *
 * Two facts shape everything here:
 *
 *  - **Ids are of two species.** `files.id` and `doc_mount_file_links.id` both
 *    appear in `attachments`, in `chats.characterAvatars`, in
 *    `characters.defaultImageId`. Every entry therefore carries its `idKind`
 *    and every action branches on it rather than guessing.
 *  - **Announcement messages are optional.** `postLanternImageNotification` is
 *    skipped when `alertCharactersOfLanternImages` is off, which is the
 *    default, so backgrounds and avatars usually have no message row at all.
 *    A gallery built by walking messages would miss most of them.
 *
 * @module photos/chat-gallery
 */

import path from 'path';
import { logger } from '@/lib/logger';
import { getFilePath } from '@/lib/api/middleware/file-path';
import { resolveCharacterAvatar } from './resolve-character-avatar';
import { getPhotoLinkSummaryBySha256, type PhotoLinkSummary } from './photo-link-summary';
import { isPhotosRelativePath } from './photos-paths';
import { nativeTextAttachmentMime } from '@/lib/mount-index/path-utils';
import type { RepositoryContainer } from '@/lib/database/repositories';
import type { ChatEvent, ChatMetadata } from '@/lib/schemas/chat.types';
import type { Character } from '@/lib/schemas/character.types';
import type { FileEntry } from '@/lib/schemas/types';

const log = logger.child({ module: 'photos.chat-gallery' });

// ============================================================================
// Types
// ============================================================================

/** Which table owns the id an entry carries. */
export type ChatGalleryIdKind = 'file' | 'link';

/**
 * Where the image came from, as far as the chat is concerned. These are the
 * reader-facing buckets the gallery's filter chips are built from, not a
 * one-to-one map of the nine mechanisms — `attachment` covers both a user's
 * upload and a Librarian attach, and `generated` covers both entry points to
 * image generation.
 */
export type ChatGallerySource =
  | 'attachment'        // a user upload, a linked library file, a Librarian attach
  | 'generated'         // generate_image, or either Generate Image dialog
  | 'story-background'  // a backdrop the Lantern painted for this chat
  | 'avatar'            // an Aurora repaint during this chat
  | 'portrait'          // a participant's standing portrait
  | 'kept'              // re-shown out of an album by attach_image
  | 'inline';           // referenced by a Markdown ![](…) in message text

/** Every source, in the order the UI shows its filter chips. */
export const CHAT_GALLERY_SOURCES: readonly ChatGallerySource[] = [
  'story-background',
  'avatar',
  'portrait',
  'generated',
  'attachment',
  'kept',
  'inline',
];

export interface ChatGalleryEntry {
  /** `files.id` or `doc_mount_file_links.id` — read `idKind` before using it. */
  id: string;
  idKind: ChatGalleryIdKind;
  /** Inline-served URL (`/api/v1/files/…` or a mount-point blob). */
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  sha256?: string;
  /** ISO timestamp; the sort key. */
  createdAt: string;
  source: ChatGallerySource;
  /** The character this image is *of* or *by*, when known. */
  characterId?: string;
  characterName?: string;
  /** The message it hangs beneath, when one exists. */
  messageId?: string;
  /** The background the chat is showing / the avatar a character is wearing. */
  isCurrent: boolean;
  /** Whether the chat itself owns the record and may delete it. */
  deletable: boolean;
  /** How many albums already hold these bytes. */
  linkSummary?: PhotoLinkSummary;
}

export interface ChatGalleryResult {
  entries: ChatGalleryEntry[];
  counts: Record<ChatGallerySource, number>;
  total: number;
}

/**
 * One mount-index attachment lifted off a message. Shared by the gallery and
 * by `GET /api/v1/chats/[id]/files`, which is why it carries the non-image
 * fields (a native-text document has no blob) the file listing needs.
 */
export interface MountAttachmentEntry {
  /** `doc_mount_file_links.id`. */
  id: string;
  filename: string;
  /** The API URL that serves the bytes (blob endpoint, or the files endpoint for a document). */
  url: string;
  mimeType: string;
  size: number;
  /** The announcing message's `createdAt` — a link row has no chat-scoped timestamp. */
  createdAt: string;
  messageId: string;
  mountPointId: string;
  relativePath: string;
  /** True when the bytes live in `doc_mount_blobs`; false for a native-text document. */
  hasBlob: boolean;
  sha256: string | null;
}

// ============================================================================
// Pass 2 — the message walk (shared with GET /chats/[id]/files)
// ============================================================================

/**
 * Walk a chat's messages and resolve every attachment id that names a
 * mount-index file link.
 *
 * Mount-file attachments are recorded *only* on the message that announced
 * them — `files.addLink` on a link id is a silent no-op, so there is no
 * `linkedTo` row to find them by. This is sources #4 (`attach_image` re-show
 * of a kept vault image) and #5 (a Librarian attach from a document store).
 *
 * Lifted out of the `/chats/[id]/files` route so the file listing and the
 * gallery cannot drift apart; the route still owns its own response shape.
 *
 * Best effort throughout: an id that resolves to nothing is skipped, and a
 * repository failure aborts the walk with a `warn` rather than failing the
 * request. An empty gallery is a worse answer than a short one, but a 500 is
 * worse than both.
 *
 * @param events The chat's events, as returned by `repos.chats.getMessages`.
 * @param repos Repository container.
 * @param options.skipIds Ids already accounted for by an earlier pass.
 */
export async function resolveMessageAttachmentEntries(
  events: readonly ChatEvent[],
  repos: RepositoryContainer,
  options: { skipIds?: ReadonlySet<string> } = {},
): Promise<MountAttachmentEntry[]> {
  const skipIds = options.skipIds ?? new Set<string>();
  const resolved: MountAttachmentEntry[] = [];
  const seen = new Set<string>();

  try {
    for (const event of events) {
      if (event.type !== 'message') continue;
      const ids = Array.isArray(event.attachments) ? event.attachments : [];
      for (const attachmentId of ids) {
        if (skipIds.has(attachmentId) || seen.has(attachmentId)) continue;

        // Try as a link id (modern) or fall back to file id.
        let mountLink = await repos.docMountFileLinks.findByIdWithContent(attachmentId);
        if (!mountLink) {
          const links = await repos.docMountFileLinks.findByFileId(attachmentId);
          mountLink = links[0] ?? null;
        }
        if (!mountLink) continue;
        if (seen.has(mountLink.id) || skipIds.has(mountLink.id)) continue;

        const blob = await repos.docMountBlobs.findByFileId(mountLink.fileId);
        if (blob) {
          resolved.push({
            id: mountLink.id,
            filename: mountLink.originalFileName ?? mountLink.fileName,
            url: buildBlobUrl(mountLink.mountPointId, mountLink.relativePath),
            mimeType: blob.storedMimeType,
            size: blob.sizeBytes,
            createdAt: event.createdAt,
            messageId: event.id,
            mountPointId: mountLink.mountPointId,
            relativePath: mountLink.relativePath,
            hasBlob: true,
            sha256: blob.sha256 ?? mountLink.sha256 ?? null,
          });
          seen.add(mountLink.id);
          continue;
        }

        // No blob → a native-text document (Bug 38). Surface it from the
        // document row so the attached markdown shows in the file list. The
        // gallery drops these on the mime check.
        const textMime = nativeTextAttachmentMime(mountLink.relativePath);
        if (!textMime) continue;
        const document = await repos.docMountDocuments.findByFileId(mountLink.fileId);
        if (!document) continue;
        resolved.push({
          id: mountLink.id,
          filename: mountLink.originalFileName ?? mountLink.fileName,
          url: buildDocumentUrl(mountLink.mountPointId, mountLink.relativePath),
          mimeType: textMime,
          size: mountLink.fileSizeBytes,
          createdAt: event.createdAt,
          messageId: event.id,
          mountPointId: mountLink.mountPointId,
          relativePath: mountLink.relativePath,
          hasBlob: false,
          sha256: mountLink.sha256 ?? null,
        });
        seen.add(mountLink.id);
      }
    }
  } catch (err) {
    log.warn('Failed to enumerate mount-file attachments', {
      error: err instanceof Error ? err.message : String(err),
      resolvedSoFar: resolved.length,
    });
  }

  return resolved;
}

// ============================================================================
// The enumerator
// ============================================================================

/**
 * List every image in a chat, whatever produced it.
 *
 * Four passes, in order; the first pass to see an image wins its `source`, and
 * a later pass may only *add* a `messageId`. Deduped by sha256 where known and
 * by `(idKind, id)` otherwise; sorted newest first, with portraits carrying
 * their character's `createdAt` so a standing portrait lands at the end of the
 * roll rather than the top of it.
 *
 * Pure over `repos` — no HTTP, no request context. Returns `[]` for a chat
 * that does not exist.
 */
export async function listChatGallery(
  chatId: string,
  repos: RepositoryContainer,
): Promise<ChatGalleryEntry[]> {
  const chat = await repos.chats.findById(chatId);
  if (!chat) {
    log.debug('Gallery requested for a chat that does not exist', { chatId });
    return [];
  }

  const collector = new EntryCollector();
  const cast = await loadCast(chat, repos);
  const current = await resolveCurrentAssets(chat, repos);

  await passLinkedFiles(chatId, chat, cast, current, collector, repos);

  const events = await repos.chats.getMessages(chatId).catch((err: unknown) => {
    log.warn('Failed to read chat messages for the gallery', {
      chatId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [] as ChatEvent[];
  });

  await passMessageAttachments(events, collector, repos);
  await passCastPortraits(chat, cast, collector, repos);
  await passInlineMarkdown(events, chat, cast, collector, repos);

  const entries = collector.finish();
  log.debug('Chat gallery enumerated', {
    chatId,
    total: entries.length,
    bySource: countBySource(entries),
  });
  return entries;
}

/**
 * `listChatGallery` plus the per-source tally the filter chips and the sidebar
 * count read. One call so the route never counts a list it just built.
 */
export async function getChatGallery(
  chatId: string,
  repos: RepositoryContainer,
): Promise<ChatGalleryResult> {
  const entries = await listChatGallery(chatId, repos);
  return { entries, counts: countBySource(entries), total: entries.length };
}

export function countBySource(
  entries: readonly ChatGalleryEntry[],
): Record<ChatGallerySource, number> {
  const counts = Object.fromEntries(
    CHAT_GALLERY_SOURCES.map((source) => [source, 0]),
  ) as Record<ChatGallerySource, number>;
  for (const entry of entries) counts[entry.source] += 1;
  return counts;
}

// ============================================================================
// Pass 1 — files linked to the chat
// ============================================================================

/**
 * What the chat is currently *showing*: the background on the wall and the
 * avatar each character is wearing.
 *
 * Matched on id **and** sha256, for the reason the stale-chat collapse sweep
 * matches on both: those fields hold a `files.id` when the story-background
 * and avatar jobs wrote them, and a `doc_mount_file_links.id` when an import
 * or a migration did, so an id comparison alone misses half the cases.
 */
interface CurrentAssets {
  backgroundIds: Set<string>;
  backgroundShas: Set<string>;
  /** imageId (or its sha256) → the character wearing it. */
  avatarIds: Map<string, string>;
  avatarShas: Map<string, string>;
}

/**
 * Every character in the cast, loaded once. Three passes want them — the
 * repaint's owner, the standing portrait, and the vault a relative Markdown
 * path resolves against — and a per-pass `findById` would read the same rows
 * three times over.
 */
interface Cast {
  byCharacterId: Map<string, Character>;
}

async function loadCast(chat: ChatMetadata, repos: RepositoryContainer): Promise<Cast> {
  const byCharacterId = new Map<string, Character>();
  const ids = participantCharacterIds(chat);
  if (ids.length === 0) return { byCharacterId };
  try {
    // `findByIds` drops broken-vault characters rather than throwing, which is
    // the behaviour a gallery wants: one unreadable character costs its own
    // portrait, not the whole roll.
    for (const character of await repos.characters.findByIds(ids)) {
      byCharacterId.set(character.id, character);
    }
  } catch (err) {
    log.warn('Failed to load the chat cast for the gallery', {
      chatId: chat.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return { byCharacterId };
}

async function resolveCurrentAssets(
  chat: ChatMetadata,
  repos: RepositoryContainer,
): Promise<CurrentAssets> {
  const current: CurrentAssets = {
    backgroundIds: new Set(),
    backgroundShas: new Set(),
    avatarIds: new Map(),
    avatarShas: new Map(),
  };

  if (chat.storyBackgroundImageId) {
    current.backgroundIds.add(chat.storyBackgroundImageId);
    const resolved = await safeResolveAvatar(chat.storyBackgroundImageId, repos);
    if (resolved?.sha256) current.backgroundShas.add(resolved.sha256);
  }

  // `characterAvatars` is an object map keyed by characterId:
  //   { [characterId]: { imageId, generatedAt, afterMessageCount } }
  const avatars = chat.characterAvatars;
  if (avatars && typeof avatars === 'object') {
    for (const [characterId, entry] of Object.entries(avatars as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue;
      const imageId = (entry as { imageId?: unknown }).imageId;
      if (typeof imageId !== 'string' || !imageId) continue;
      current.avatarIds.set(imageId, characterId);
      const resolved = await safeResolveAvatar(imageId, repos);
      if (resolved?.sha256) current.avatarShas.set(resolved.sha256, characterId);
    }
  }

  return current;
}

async function passLinkedFiles(
  chatId: string,
  chat: ChatMetadata,
  cast: Cast,
  current: CurrentAssets,
  collector: EntryCollector,
  repos: RepositoryContainer,
): Promise<void> {
  const files = await repos.files.findByLinkedTo(chatId);
  const images = files.filter((f) => isImageMime(f.mimeType));

  // Which characters this chat has ever overridden an avatar for. A superseded
  // repaint is no longer in `chat.characterAvatars`, so this is how it keeps
  // its character attribution.
  const overrideOwners = resolveAvatarOverrideOwners(cast, chatId);

  let found = 0;
  for (const file of images) {
    const linkSummary = file.sha256
      ? await safeLinkSummary(file.sha256, repos)
      : undefined;
    const paths = linkSummary?.linkers.map((l) => l.relativePath) ?? [];

    const isCurrentBackground =
      current.backgroundIds.has(file.id) ||
      (!!file.sha256 && current.backgroundShas.has(file.sha256));
    const avatarOwner =
      current.avatarIds.get(file.id) ??
      (file.sha256 ? current.avatarShas.get(file.sha256) : undefined);

    let source: ChatGallerySource;
    let characterId: string | undefined;
    let isCurrent = false;

    if (isCurrentBackground || paths.some(isStoryBackgroundPath)) {
      source = 'story-background';
      isCurrent = isCurrentBackground;
    } else if (avatarOwner || isAvatarFile(file, paths) || overrideOwners.has(file.id)) {
      source = 'avatar';
      isCurrent = !!avatarOwner;
      characterId =
        avatarOwner ??
        overrideOwners.get(file.id) ??
        // The avatar job tags the file with the character it painted, and
        // links it to `[chatId, characterId]`; either is a usable fallback
        // for a repaint the chat has since moved on from.
        file.tags?.find((t) => t !== chatId) ??
        file.linkedTo?.find((t) => t !== chatId);
    } else if (file.source === 'GENERATED') {
      source = 'generated';
    } else {
      source = 'attachment';
    }

    collector.add({
      id: file.id,
      idKind: 'file',
      url: getFilePath(file),
      filename: file.originalFilename,
      mimeType: file.mimeType,
      size: file.size,
      width: file.width ?? undefined,
      height: file.height ?? undefined,
      sha256: file.sha256 || undefined,
      createdAt: file.createdAt,
      source,
      characterId,
      isCurrent,
      // The chat minted this record, so the chat may retire it — but never the
      // one it is currently showing.
      deletable: !isCurrent && OWNED_SOURCES.has(source),
      linkSummary,
    });
    found += 1;
  }

  log.debug('Chat gallery pass complete', { chatId, pass: 'linked-files', found });
}

/** Sources whose records the chat itself owns and may therefore delete. */
const OWNED_SOURCES = new Set<ChatGallerySource>([
  'attachment',
  'generated',
  'story-background',
  'avatar',
]);

/**
 * Which superseded repaints belong to which character, read off every
 * participant's `avatarOverrides` row for this chat.
 */
function resolveAvatarOverrideOwners(cast: Cast, chatId: string): Map<string, string> {
  const owners = new Map<string, string>();
  for (const [characterId, character] of cast.byCharacterId) {
    for (const override of character.avatarOverrides ?? []) {
      if (override.chatId === chatId && override.imageId) {
        owners.set(override.imageId, characterId);
      }
    }
  }
  return owners;
}

/** The Lantern writes a chat's backdrops to `generated/` in its own mount. */
function isStoryBackgroundPath(relativePath: string): boolean {
  return relativePath.toLowerCase().startsWith('generated/');
}

/**
 * An Aurora repaint, recognised by where it was stored: `images/history/` in
 * the character's vault, or the legacy `/character-avatars/` project folder
 * for a chat whose files live in a project mount.
 */
function isAvatarFile(file: FileEntry, paths: readonly string[]): boolean {
  if (file.folderPath === '/character-avatars/') return true;
  return paths.some((p) => p.toLowerCase().startsWith('images/history/'));
}

// ============================================================================
// Pass 2 — message attachments
// ============================================================================

async function passMessageAttachments(
  events: readonly ChatEvent[],
  collector: EntryCollector,
  repos: RepositoryContainer,
): Promise<void> {
  // A file already found in pass 1 needs no mount lookup — but it may still
  // learn which message it hangs beneath, which is what gives the detail view
  // its "Jump to message" link.
  for (const event of events) {
    if (event.type !== 'message') continue;
    for (const attachmentId of event.attachments ?? []) {
      collector.noteMessage(attachmentId, event.id);
    }
  }

  const mountEntries = await resolveMessageAttachmentEntries(events, repos, {
    skipIds: collector.knownIds(),
  });

  let found = 0;
  for (const entry of mountEntries) {
    if (!entry.hasBlob || !isImageMime(entry.mimeType)) continue;
    const linkSummary = entry.sha256
      ? await safeLinkSummary(entry.sha256, repos)
      : undefined;
    collector.add({
      id: entry.id,
      idKind: 'link',
      url: entry.url,
      filename: entry.filename,
      mimeType: entry.mimeType,
      size: entry.size,
      sha256: entry.sha256 ?? undefined,
      createdAt: entry.createdAt,
      // A link that lives in a `photos/` folder is an album image the chat is
      // being shown again; anything else is a document store's file, attached.
      source: isPhotosRelativePath(entry.relativePath) ? 'kept' : 'attachment',
      messageId: entry.messageId,
      isCurrent: false,
      // The album or the store owns these bytes, not the chat.
      deletable: false,
      linkSummary,
    });
    found += 1;
  }

  log.debug('Chat gallery pass complete', { pass: 'message-attachments', found });
}

// ============================================================================
// Pass 3 — the cast's standing portraits
// ============================================================================

async function passCastPortraits(
  chat: ChatMetadata,
  cast: Cast,
  collector: EntryCollector,
  repos: RepositoryContainer,
): Promise<void> {
  let found = 0;
  for (const characterId of participantCharacterIds(chat)) {
    const character = cast.byCharacterId.get(characterId);
    if (!character?.defaultImageId) continue;

    const resolved = await safeResolveAvatar(character.defaultImageId, repos);
    if (!resolved) continue;

    // An Aurora repaint that was promoted to the character's default is
    // already on the roll under its own source; do not hang it twice.
    if (resolved.sha256 && collector.hasSha(resolved.sha256)) continue;

    const filename =
      (resolved.relativePath ? path.posix.basename(resolved.relativePath) : null) ??
      `${character.name}.webp`;

    collector.add({
      id: character.defaultImageId,
      idKind: resolved.kind === 'vault-link' ? 'link' : 'file',
      url: resolved.url,
      filename,
      mimeType: resolved.mimeType ?? 'image/webp',
      size: 0,
      sha256: resolved.sha256 ?? undefined,
      // A portrait is not an event in the conversation, so it sorts by the
      // character's own age and lands at the end of the roll.
      createdAt: character.createdAt,
      source: 'portrait',
      characterId,
      characterName: character.name,
      isCurrent: true,
      // The character owns their portrait; the chat is only looking at it.
      deletable: false,
    });
    found += 1;
  }

  log.debug('Chat gallery pass complete', { pass: 'cast-portraits', found });
}

// ============================================================================
// Pass 4 — images woven into the prose
// ============================================================================

/** `![alt](url)` — the url runs to the first whitespace or closing paren. */
const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\(\s*([^)\s]+)/g;
// The id segment is matched loosely and `files.findById` is the arbiter: a
// path that looks like a file URL but names nothing is a skip, and a stricter
// pattern here would only turn "not found" into "not even looked for".
const FILE_URL_RE = /^\/api\/v1\/files\/([A-Za-z0-9_-]+)(?:[/?#]|$)/;
const BLOB_URL_RE = /^\/api\/v1\/mount-points\/([^/]+)\/blobs\/(.+)$/;
const IMAGE_EXTENSIONS = new Set(['.webp', '.png', '.jpg', '.jpeg', '.gif', '.avif', '.svg']);

/**
 * Scan message prose for Markdown image references.
 *
 * Absolute `/api/v1/files/<uuid>` and `/api/v1/mount-points/<id>/blobs/<path>`
 * URLs are taken as written. A relative path is resolved against the author's
 * own vault mount, mirroring what `MessageContent.tsx` does at render time.
 *
 * A resolvable reference becomes a real entry carrying a real id — the
 * `files.id` from the URL, or the `doc_mount_file_links.id` the blob path
 * names — so Save works on it like any other picture. A reference that
 * resolves to no record is skipped with a `debug` line, never an error.
 * Anything already on the roll from an earlier pass keeps the source it earned
 * there, so a `generate_image` output the model also wrote into its prose
 * stays `generated`.
 */
async function passInlineMarkdown(
  events: readonly ChatEvent[],
  chat: ChatMetadata,
  cast: Cast,
  collector: EntryCollector,
  repos: RepositoryContainer,
): Promise<void> {
  const vaultByParticipant = vaultMountByParticipant(chat, cast);
  let found = 0;
  let skipped = 0;

  for (const event of events) {
    if (event.type !== 'message') continue;
    if (event.role === 'SYSTEM') continue;
    if (!event.content) continue;

    for (const match of event.content.matchAll(MARKDOWN_IMAGE_RE)) {
      const raw = match[1];
      if (!raw || raw.startsWith('data:') || /^([a-z]+:)?\/\//i.test(raw)) continue;

      const fileMatch = FILE_URL_RE.exec(raw);
      if (fileMatch) {
        const added = await addFileReference(fileMatch[1], event.id, collector, repos);
        if (added) found += 1; else skipped += 1;
        continue;
      }

      const blobMatch = BLOB_URL_RE.exec(raw);
      if (blobMatch) {
        const added = await addBlobReference(
          blobMatch[1],
          safeDecodeUri(blobMatch[2]),
          event.id,
          collector,
          repos,
        );
        if (added) found += 1; else skipped += 1;
        continue;
      }

      if (raw.startsWith('/')) {
        // Some other absolute path in the app. Nothing here can resolve it to
        // a record, so it is not a gallery entry.
        skipped += 1;
        continue;
      }

      // Relative — resolve against the author's vault, the way the renderer
      // does. An author with no vault (or a message with no author) leaves the
      // reference unresolvable, which is a skip, never an error.
      const mountPointId = event.participantId
        ? vaultByParticipant.get(event.participantId)
        : undefined;
      if (!mountPointId) {
        skipped += 1;
        continue;
      }
      if (!IMAGE_EXTENSIONS.has(path.posix.extname(raw).toLowerCase())) {
        skipped += 1;
        continue;
      }
      const added = await addBlobReference(mountPointId, raw, event.id, collector, repos);
      if (added) found += 1; else skipped += 1;
    }
  }

  log.debug('Chat gallery pass complete', { pass: 'inline-markdown', found, skipped });
}

/**
 * Turn a `(mountPointId, relativePath)` reference into an entry carrying the
 * link row's own id, so the detail view's Save has a real record to hand
 * `saveImageToAlbum`. Returns false when nothing in the mount index answers to
 * that path — a stale reference in old prose, which is a skip.
 */
async function addBlobReference(
  mountPointId: string,
  relativePath: string,
  messageId: string,
  collector: EntryCollector,
  repos: RepositoryContainer,
): Promise<boolean> {
  let link;
  try {
    link = await repos.docMountFileLinks.findByMountPointAndPath(mountPointId, relativePath);
  } catch (err) {
    log.debug('Inline image reference did not resolve', {
      mountPointId,
      relativePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
  if (!link) {
    log.debug('Inline image reference names no mount-index row', { mountPointId, relativePath });
    return false;
  }
  if (collector.has(link.id)) {
    collector.noteMessage(link.id, messageId);
    return false;
  }
  const filename = link.originalFileName ?? link.fileName ?? path.posix.basename(relativePath);
  collector.add({
    id: link.id,
    idKind: 'link',
    url: buildBlobUrl(mountPointId, relativePath),
    filename,
    mimeType: link.originalMimeType || mimeFromExtension(filename),
    size: link.fileSizeBytes ?? 0,
    sha256: link.sha256 || undefined,
    createdAt: link.createdAt,
    source: 'inline',
    messageId,
    isCurrent: false,
    // Woven into someone's prose and owned by whatever store holds it.
    deletable: false,
  });
  return true;
}

/**
 * Turn a `/api/v1/files/<uuid>` reference into an entry off the file row it
 * names, so the picture carries its real filename, size and hash rather than a
 * shape guessed from the URL. Returns false when the row is gone.
 */
async function addFileReference(
  fileId: string,
  messageId: string,
  collector: EntryCollector,
  repos: RepositoryContainer,
): Promise<boolean> {
  if (collector.has(fileId)) {
    collector.noteMessage(fileId, messageId);
    return false;
  }
  const file = await repos.files.findById(fileId).catch(() => null);
  if (!file || !isImageMime(file.mimeType)) {
    log.debug('Inline image reference names no file row', { fileId });
    return false;
  }
  collector.add({
    id: file.id,
    idKind: 'file',
    url: getFilePath(file),
    filename: file.originalFilename,
    mimeType: file.mimeType,
    size: file.size,
    width: file.width ?? undefined,
    height: file.height ?? undefined,
    sha256: file.sha256 || undefined,
    createdAt: file.createdAt,
    source: 'inline',
    messageId,
    isCurrent: false,
    // Woven into someone's prose; the chat did not mint the record.
    deletable: false,
  });
  return true;
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

/**
 * The vault mount each participant's character writes into, so a relative
 * `![](images/foo.webp)` in that participant's message can be resolved.
 */
function vaultMountByParticipant(chat: ChatMetadata, cast: Cast): Map<string, string> {
  const byParticipant = new Map<string, string>();
  for (const participant of chat.participants ?? []) {
    if (!participant.characterId) continue;
    const mountPointId = cast.byCharacterId.get(participant.characterId)
      ?.characterDocumentMountPointId;
    if (mountPointId) byParticipant.set(participant.id, mountPointId);
  }
  return byParticipant;
}

// ============================================================================
// Collector
// ============================================================================

/**
 * Accumulates entries across the four passes, holding the two dedup rules the
 * design turns on: the first pass to see an image wins its source, and a later
 * pass may only add a `messageId`.
 */
class EntryCollector {
  private readonly entries: ChatGalleryEntry[] = [];
  private readonly byId = new Map<string, ChatGalleryEntry>();
  private readonly bySha = new Map<string, ChatGalleryEntry>();
  /** messageId for an attachment id seen before its entry existed. */
  private readonly pendingMessages = new Map<string, string>();

  add(entry: ChatGalleryEntry): void {
    if (this.byId.has(entry.id)) return;
    if (entry.sha256) {
      const twin = this.bySha.get(entry.sha256);
      if (twin) {
        // The same bytes under a second id — one picture, whichever pass saw
        // it first. The later sighting may still contribute the message the
        // picture hangs beneath, which is the one field a later pass may add.
        this.byId.set(entry.id, twin);
        const messageId = entry.messageId ?? this.pendingMessages.get(entry.id);
        if (messageId && !twin.messageId) twin.messageId = messageId;
        return;
      }
    }

    const pending = this.pendingMessages.get(entry.id);
    if (pending && !entry.messageId) entry.messageId = pending;

    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    if (entry.sha256) this.bySha.set(entry.sha256, entry);
  }

  /** Record the message an id hangs beneath, whether or not its entry exists yet. */
  noteMessage(id: string, messageId: string): void {
    const existing = this.byId.get(id);
    if (existing) {
      if (!existing.messageId) existing.messageId = messageId;
      return;
    }
    if (!this.pendingMessages.has(id)) this.pendingMessages.set(id, messageId);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  hasSha(sha256: string): boolean {
    return this.bySha.has(sha256);
  }

  knownIds(): ReadonlySet<string> {
    return new Set(this.byId.keys());
  }

  finish(): ChatGalleryEntry[] {
    return [...this.entries].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }
}

// ============================================================================
// Helpers
// ============================================================================

export function buildBlobUrl(mountPointId: string, relativePath: string): string {
  return `/api/v1/mount-points/${mountPointId}/blobs/${encodeURI(relativePath)}`;
}

export function buildDocumentUrl(mountPointId: string, relativePath: string): string {
  return `/api/v1/mount-points/${mountPointId}/files/${encodeURI(relativePath)}`;
}

function isImageMime(mimeType: string | null | undefined): boolean {
  return !!mimeType && mimeType.toLowerCase().startsWith('image/');
}

function mimeFromExtension(filename: string): string {
  switch (path.posix.extname(filename).toLowerCase()) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.avif': return 'image/avif';
    case '.svg': return 'image/svg+xml';
    default: return 'image/webp';
  }
}

function participantCharacterIds(chat: ChatMetadata): string[] {
  const ids: string[] = [];
  for (const participant of chat.participants ?? []) {
    if (participant.type !== 'CHARACTER') continue;
    if (participant.status === 'removed') continue;
    if (participant.characterId && !ids.includes(participant.characterId)) {
      ids.push(participant.characterId);
    }
  }
  return ids;
}

async function safeResolveAvatar(id: string, repos: RepositoryContainer) {
  try {
    return await resolveCharacterAvatar(id, repos);
  } catch (err) {
    log.debug('Avatar id did not resolve', {
      id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function safeLinkSummary(
  sha256: string,
  repos: RepositoryContainer,
): Promise<PhotoLinkSummary | undefined> {
  try {
    return await getPhotoLinkSummaryBySha256(sha256, repos);
  } catch (err) {
    log.debug('Photo link summary failed', {
      sha256,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}
