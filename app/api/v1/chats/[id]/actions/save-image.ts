/**
 * Chats API v1 — Save Image Action (chat-scoped)
 *
 * POST /api/v1/chats/[id]?action=save-image
 *
 * The chat-scoped twin of the message toolbar's
 * `POST /chats/[id]/messages/[messageId]?action=save-image`. Same body, same
 * album service, same attribution rule — a different guard.
 *
 * The message route asks *"is this image attached to this message"*, which is
 * a real invariant there: it is what the sidecar's scene snapshot and its
 * byline are anchored to. But half the gallery has no message at all — a
 * Lantern backdrop and an Aurora repaint post no announcement when
 * `alertCharactersOfLanternImages` is off (the default), and a participant's
 * standing portrait was never part of a turn. Rather than invent a message for
 * those, this route asks the question the gallery can actually answer: *"is
 * this image in this chat's gallery"*, which the enumerator already knows.
 *
 * @module api/v1/chats/[id]/actions/save-image
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { badRequest, notFound, serverError, successResponse } from '@/lib/api/responses';
import {
  saveImageToAlbum,
  SaveImageToAlbumError,
  SaveImageRequestSchema,
} from '@/lib/photos/save-image-to-album';
import { resolveSaveAttribution } from '@/lib/photos/save-attribution';
import { listChatGallery } from '@/lib/photos/chat-gallery';
import type { RequestContext } from '@/lib/api/middleware';

/**
 * Save any image the chat's gallery holds into a chosen photo album.
 */
export async function handleSaveGalleryImage(
  req: NextRequest,
  chatId: string,
  ctx: RequestContext,
): Promise<NextResponse> {
  const { user, repos } = ctx;
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = SaveImageRequestSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest(parsed.error.issues.map((i) => i.message).join('; '));
    }
    const { fileId, mountPointId, caption, tags } = parsed.data;

    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return notFound('Chat');
    }

    // The guard: the id must name a picture this conversation actually holds.
    // Without it the action would save any image in the instance into any
    // album on the strength of a chat id.
    const entries = await listChatGallery(chatId, repos);
    const entry = entries.find((e) => e.id === fileId);
    if (!entry) {
      logger.info('[SaveGalleryImage] rejected: id is not in this chat gallery', {
        chatId,
        fileId,
        galleryTotal: entries.length,
      });
      return badRequest('Image is not in this chat');
    }

    const attribution = await resolveSaveAttribution(chat, mountPointId, user, repos);

    logger.debug('[SaveGalleryImage] saving', {
      chatId,
      fileId,
      idKind: entry.idKind,
      source: entry.source,
      mountPointId,
      attributionRole: attribution.role,
    });

    const saved = await saveImageToAlbum({
      mountPointId,
      fileId,
      caption: caption ?? null,
      tags: tags ?? [],
      chatId,
      attribution,
    });

    logger.info('[SaveGalleryImage] saved', {
      chatId,
      fileId,
      source: entry.source,
      mountPointId,
      relativePath: saved.relativePath,
      linkId: saved.linkId,
    });

    return successResponse({
      saved: true,
      mountPoint: saved.mountPointName,
      relativePath: saved.relativePath,
      linkId: saved.linkId,
      keptAt: saved.keptAt,
      fileId: saved.fileId,
      sha256: saved.sha256,
    });
  } catch (error) {
    if (error instanceof SaveImageToAlbumError) {
      logger.info('[SaveGalleryImage] rejected', {
        chatId,
        code: error.code,
        message: error.message,
      });
      // Already in that album is not a failure of the request — it is the
      // answer to it, and the dialog says so in those words.
      if (error.code === 'ALREADY_SAVED') {
        return NextResponse.json(
          {
            error: error.message,
            code: error.code,
            relativePath: error.existingRelativePath,
            keptAt: error.existingCreatedAt,
          },
          { status: 409 },
        );
      }
      return badRequest(error.message);
    }
    logger.error(
      '[SaveGalleryImage] failed',
      { chatId },
      error instanceof Error ? error : undefined,
    );
    return serverError('Failed to save image');
  }
}
