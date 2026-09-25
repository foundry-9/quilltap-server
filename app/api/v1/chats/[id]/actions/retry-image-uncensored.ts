/**
 * Chats API v1 - "Try uncensored" on a picture
 *
 * POST /api/v1/chats/[id]?action=retry-image-uncensored
 *   body `{ toolMessageId }` — re-run a `generate_image` call on the
 *     Concierge's uncensored understudy, with the same arguments. The result
 *     posts as a new TOOL message (attachments, trail via `'concierge'`) beside
 *     the original, and the Concierge announces the reroute when the original
 *     was a refusal.
 *   body `{ kind: 'background' }` — queue a story background that paints on
 *     the uncensored understudy (`payload.forceUncensored`).
 *
 * 409 `{ error: 'locked' }` on a Locked chat, `{ error: 'no-understudy' }` when
 * there is nobody to send it to. The chat's Concierge state is never changed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { badRequest, conflict, errorResponse, notFound, successResponse } from '@/lib/api/responses';
import { executeImageGenerationTool } from '@/lib/tools/handlers/image-generation-handler';
import { saveToolMessages } from '@/lib/services/chat-message/tool-execution.service';
import type { GeneratedImage, ToolMessage } from '@/lib/services/chat-message/types';
import {
  composeRetryRouteTrail,
  resolveImageRetryUnderstudy,
} from '@/lib/services/dangerous-content/retry-uncensored';
import { postConciergeRefusalAnnouncement } from '@/lib/services/concierge-notifications/writer';
import { resolveImageProfileForChat } from '@/lib/image-gen/profile-resolution';
import type { RouteAttempt } from '@/lib/schemas/chat.types';
import type { ChatMetadata, MessageEvent } from '@/lib/schemas/types';
import type { RequestContext } from '@/lib/api/middleware';
import { handleRegenerateBackground } from './story-background';

const retryImageSchema = z.union([
  z.object({ toolMessageId: z.string().min(1) }),
  z.object({ kind: z.literal('background') }),
]);

interface StoredToolContent {
  toolName?: string;
  arguments?: Record<string, unknown>;
}

function parseToolContent(content: string): StoredToolContent | null {
  try {
    const parsed = JSON.parse(content) as StoredToolContent;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function handleRetryImageUncensored(
  req: NextRequest,
  chatId: string,
  chat: ChatMetadata,
  ctx: RequestContext
): Promise<NextResponse> {
  const { user, repos } = ctx;
  const parsed = retryImageSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return badRequest('Expected { toolMessageId } or { kind: "background" }');
  }
  const chatSettings = await repos.chatSettings.findByUserId(user.id);

  // --- The Lantern's backdrop -------------------------------------------------
  if ('kind' in parsed.data) {
    const imageProfileId = await resolveImageProfileForChat(user.id, chat, chatSettings, repos);
    const gate = await resolveImageRetryUnderstudy({
      userId: user.id,
      chat,
      chatSettings,
      excludeProfileIds: [imageProfileId],
    });
    if (!gate.ok) {
      logger.info('[DangerousContent] Uncensored background retry refused', { chatId, reason: gate.reason });
      return conflict(gate.reason);
    }
    logger.info('[DangerousContent] Queueing a story background on the uncensored desk', {
      chatId,
      understudyProfileId: gate.understudy.profile.id,
    });
    return handleRegenerateBackground(chatId, chat, ctx, { forceUncensored: true });
  }

  // --- A generate_image picture ----------------------------------------------
  const { toolMessageId } = parsed.data;
  const messages = await repos.chats.getMessages(chatId);
  const toolMessage = messages.find(
    (m): m is MessageEvent => m.type === 'message' && m.id === toolMessageId
  );
  if (!toolMessage || toolMessage.role !== 'TOOL') {
    return notFound('Tool message');
  }
  const stored = parseToolContent(toolMessage.content);
  if (stored?.toolName !== 'generate_image' || !stored.arguments) {
    return badRequest('Only generate_image pictures can be retried uncensored');
  }

  const gate = await resolveImageRetryUnderstudy({
    userId: user.id,
    chat,
    chatSettings,
    excludeProfileIds: [chat.imageProfileId],
    trail: toolMessage.routeTrail,
  });
  if (!gate.ok) {
    logger.info('[DangerousContent] Uncensored picture retry refused', {
      chatId,
      toolMessageId,
      reason: gate.reason,
    });
    return conflict(gate.reason);
  }
  const { understudy } = gate;

  logger.info('[DangerousContent] Retrying a picture on the uncensored desk', {
    chatId,
    toolMessageId,
    understudyProfileId: understudy.profile.id,
    understudyName: understudy.profile.name,
  });

  const result = await executeImageGenerationTool(stored.arguments, {
    userId: user.id,
    profileId: understudy.profile.id,
    chatId,
    callingParticipantId: toolMessage.participantId ?? undefined,
    primaryVia: 'concierge',
  });

  if (!result.success || !result.images || result.images.length === 0) {
    logger.warn('[DangerousContent] Uncensored picture retry did not produce an image', {
      chatId,
      toolMessageId,
      error: result.error,
      message: result.message,
    });
    return errorResponse(result.message || 'The uncensored desk could not produce the picture', 502, {
      code: result.error,
    });
  }

  // The original's refusals, then whatever the understudy's own call sheet
  // says (non-empty only when it, too, was refused and rerouted on).
  const priorTrail = (toolMessage.routeTrail ?? []).filter((a) => a.outcome !== 'answered');
  const routeTrail: RouteAttempt[] = result.routeTrail && result.routeTrail.length > 0
    ? [...priorTrail, ...result.routeTrail]
    : composeRetryRouteTrail(toolMessage.routeTrail, understudy.profile, 'image');

  const generatedImages: GeneratedImage[] = result.images.map((img) => ({
    id: img.id,
    filename: img.filename,
    filepath: img.filepath ?? img.url,
    mimeType: img.mimeType || 'image/png',
    size: img.size || 0,
    width: img.width,
    height: img.height,
    sha256: img.sha256,
  }));
  const retryToolMessage: ToolMessage = {
    toolName: 'generate_image',
    success: true,
    content: `Generated ${generatedImages.length} image(s)`,
    arguments: stored.arguments,
    metadata: {
      provider: result.provider,
      model: result.model,
      expandedPrompt: result.expandedPrompt,
      routeTrail,
    },
  };

  const participant = toolMessage.participantId
    ? chat.participants.find((p) => p.id === toolMessage.participantId)
    : undefined;
  // Filed a millisecond after the original, so the new picture sits beside
  // the one it answers rather than at the foot of the transcript.
  const createdAt = new Date(new Date(toolMessage.createdAt).getTime() + 1).toISOString();
  const { firstToolMessageId } = await saveToolMessages(
    repos,
    chatId,
    user.id,
    [retryToolMessage],
    generatedImages,
    participant?.characterId ?? undefined,
    toolMessage.participantId ?? undefined,
    undefined,
    { createdAt }
  );

  // The Concierge says so when the original was a refusal he could not get
  // past. A soft refusal (a sanitized picture that "succeeded") has nobody to
  // name as refusing, so it passes without an announcement.
  const refused = (toolMessage.routeTrail ?? []).find((a) => a.outcome === 'refused');
  if (refused) {
    await postConciergeRefusalAnnouncement({
      chatId,
      kind: 'refusal-rerouted',
      details: {
        refusingProvider: refused.provider,
        refusingModel: refused.modelName,
        answeringProfileName: understudy.profile.name,
        purpose: 'tool',
      },
    });
  }

  logger.info('[DangerousContent] Uncensored picture retry posted', {
    chatId,
    originalToolMessageId: toolMessageId,
    toolMessageId: firstToolMessageId,
    imageCount: generatedImages.length,
    announced: !!refused,
  });

  return successResponse({
    toolMessageId: firstToolMessageId,
    images: generatedImages,
    routeTrail,
  });
}
