/**
 * Calliope API v1 - Individual Endpoint
 *
 * GET    /api/v1/calliope/[id]                   - Conversation details
 * PATCH  /api/v1/calliope/[id]                   - Rename
 * PATCH  /api/v1/calliope/[id]?action=set-model  - Switch model (same conversation continues)
 * POST   /api/v1/calliope/[id]?action=keep       - Keep a proposal: re-judged against the draft, its operations returned
 * POST   /api/v1/calliope/[id]?action=discard    - Discard a proposal
 * POST   /api/v1/calliope/[id]?action=try        - A proposal's result for the live preview (tokens + scoped custom CSS)
 * DELETE /api/v1/calliope/[id]                   - Delete (with its attachments under Calliope/)
 *
 * Keep never writes the draft (Spec J decision 3): it re-judges the proposal
 * against the draft as it now is (decision 8), records the decision, and
 * returns the operations for the editor to apply through its own edit path,
 * where they can be undone like any other edit. A proposal that no longer
 * applies is refused as stale (409) and left offered.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createContextParamsHandler, type RequestContext } from '@/lib/api/middleware';
import { dispatchAction } from '@/lib/api/middleware/actions';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { z } from 'zod';
import type { ChatEvent, ChatMetadata } from '@/lib/schemas/types';
import { badRequest, conflict, notFound, serverError, successResponse } from '@/lib/api/responses';
import { deleteConsoleAttachmentsForChat } from '@/lib/console-engine/attachments';
import { CALLIOPE_ATTACHMENT_FOLDER } from '@/lib/services/calliope/persona';
import { readStoredProposal, recordProposalDecision, viewProposal, type StoredProposal } from '@/lib/calliope/proposals';
import { previewProposal } from '@/lib/themes/assist';
import { readDraft, ThemeDraftNotFoundError } from '@/lib/themes/drafts';
import { verifyCalliopeChat } from '../_shared';

const logger = createServiceLogger('CalliopeItemRoute');

// ============================================================================
// Schemas
// ============================================================================

const renameSchema = z.object({ title: z.string().trim().min(1, 'Title is required').max(200) }).strict();

const setModelSchema = z
  .object({ connectionProfileId: z.string().uuid('A connection profile id is required') })
  .strict();

const decisionSchema = z.object({ proposalId: z.string().min(1) }).strict();

// ============================================================================
// Handler Functions
// ============================================================================

async function handleGet(_req: NextRequest, context: RequestContext, id: string): Promise<NextResponse> {
  const { repos } = context;
  const result = await verifyCalliopeChat(id, context);
  if (result instanceof NextResponse) return result;
  const { chat } = result;
  const messages = await repos.chats.getMessages(id);

  return successResponse({
    chat: {
      id: chat.id,
      title: chat.title,
      chatType: chat.chatType,
      themeDraftId: chat.themeDraftId,
      consoleConnectionProfileId: chat.consoleConnectionProfileId ?? null,
      messageCount: messages.length,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      lastMessageAt: chat.lastMessageAt ?? null,
    },
  });
}

async function handleRename(req: NextRequest, context: RequestContext, id: string): Promise<NextResponse> {
  const { repos } = context;
  const result = await verifyCalliopeChat(id, context);
  if (result instanceof NextResponse) return result;

  const { title } = renameSchema.parse(await req.json());
  const updated = await repos.chats.update(id, { title, isManuallyRenamed: true });
  if (!updated) return serverError('Failed to rename the conversation');

  logger.info('Calliope conversation renamed', { chatId: id, title });
  return successResponse({ chat: updated });
}

/** Switch the model; the same conversation continues from the next turn. */
async function handleSetModel(req: NextRequest, context: RequestContext, id: string): Promise<NextResponse> {
  const { user, repos } = context;
  const result = await verifyCalliopeChat(id, context);
  if (result instanceof NextResponse) return result;

  const { connectionProfileId } = setModelSchema.parse(await req.json());
  const profile = await repos.connections.findById(connectionProfileId);
  if (!profile || profile.userId !== user.id) return badRequest('Connection profile not found');

  const updated = await repos.chats.update(id, { consoleConnectionProfileId: connectionProfileId } as Partial<ChatMetadata>);
  if (!updated) return serverError('Failed to switch Calliope\'s model');

  logger.info('Calliope model switched', { chatId: id, connectionProfileId });
  return successResponse({ chat: updated });
}

/** The proposal's row in this conversation, or a response saying why not. */
async function findProposalEvent(
  context: RequestContext,
  chatId: string,
  proposalId: string
): Promise<{ response: NextResponse } | { event: ChatEvent; stored: StoredProposal }> {
  const messages = await context.repos.chats.getMessages(chatId);
  const event = messages.find((m) => m.id === proposalId);
  const stored = event ? readStoredProposal(event) : null;
  if (!event || !stored) return { response: notFound('Proposal') };
  if (stored.decision) return { response: conflict(`That proposal was already ${stored.decision}`) };
  return { event, stored };
}

async function handleKeep(req: NextRequest, context: RequestContext, id: string): Promise<NextResponse> {
  const result = await verifyCalliopeChat(id, context);
  if (result instanceof NextResponse) return result;
  const { chat } = result;

  const { proposalId } = decisionSchema.parse(await req.json());
  const found = await findProposalEvent(context, id, proposalId);
  if ('response' in found) return found.response;

  let draft;
  try {
    draft = await readDraft(chat.themeDraftId);
  } catch (error) {
    if (error instanceof ThemeDraftNotFoundError) return notFound('Theme draft');
    throw error;
  }

  const view = viewProposal(found.stored, draft);
  if (view.state === 'stale') {
    logger.debug('Keep refused: the proposal no longer applies', { chatId: id, proposalId, reason: view.staleReason });
    return conflict(`The draft has changed and the proposal no longer applies: ${view.staleReason}`);
  }

  await recordProposalDecision(context.repos, id, found.event, 'kept');
  logger.info('Calliope proposal kept', { chatId: id, proposalId, operations: view.operations.length, draftChanged: view.draftChanged });
  return successResponse({
    proposalId,
    operations: view.operations,
    review: view.review,
    draftChanged: view.draftChanged,
    revision: draft.revision,
    stylesRevision: draft.styles?.revision ?? null,
  });
}

/**
 * The proposal's result for Try: the tokens it leaves and the custom CSS as the
 * server compiles and scopes it. Writes nothing, records nothing; a decided
 * proposal may still be tried (to compare), a stale one may not (409).
 */
async function handleTry(req: NextRequest, context: RequestContext, id: string): Promise<NextResponse> {
  const result = await verifyCalliopeChat(id, context);
  if (result instanceof NextResponse) return result;
  const { chat } = result;

  const { proposalId } = decisionSchema.parse(await req.json());
  const messages = await context.repos.chats.getMessages(id);
  const event = messages.find((m) => m.id === proposalId);
  const stored = event ? readStoredProposal(event) : null;
  if (!stored) return notFound('Proposal');

  let draft;
  try {
    draft = await readDraft(chat.themeDraftId);
  } catch (error) {
    if (error instanceof ThemeDraftNotFoundError) return notFound('Theme draft');
    throw error;
  }

  const preview = previewProposal(draft, stored.changeSet);
  logger.debug('Calliope proposal tried', { chatId: id, proposalId, ok: preview.ok });
  if (!preview.ok) return conflict(`The proposal no longer applies: ${preview.reason}`);
  return successResponse({ proposalId, tokens: preview.tokens, custom: preview.custom });
}

async function handleDiscard(req: NextRequest, context: RequestContext, id: string): Promise<NextResponse> {
  const result = await verifyCalliopeChat(id, context);
  if (result instanceof NextResponse) return result;

  const { proposalId } = decisionSchema.parse(await req.json());
  const found = await findProposalEvent(context, id, proposalId);
  if ('response' in found) return found.response;

  await recordProposalDecision(context.repos, id, found.event, 'discarded');
  logger.info('Calliope proposal discarded', { chatId: id, proposalId });
  return successResponse({ proposalId, state: 'discarded' as const });
}

async function handleDelete(_req: NextRequest, context: RequestContext, id: string): Promise<NextResponse> {
  const { repos } = context;
  const result = await verifyCalliopeChat(id, context);
  if (result instanceof NextResponse) return result;

  // Attachments still under Calliope/ go with the conversation; moved ones are
  // kept. (`chats.delete` sweeps too, for every other path that deletes one.)
  const attachments = await deleteConsoleAttachmentsForChat(CALLIOPE_ATTACHMENT_FOLDER, repos, id);
  const deleted = await repos.chats.delete(id);
  if (!deleted) return serverError('Failed to delete the conversation');

  logger.info('Calliope conversation deleted', { chatId: id, attachmentsDeleted: attachments.deleted, attachmentsKept: attachments.kept });
  return successResponse({ deleted: true, attachmentsDeleted: attachments.deleted, attachmentsKept: attachments.kept });
}

// ============================================================================
// Route Handlers
// ============================================================================

export const GET = createContextParamsHandler<{ id: string }>(async (req, context, { id }) =>
  dispatchAction(req, {}, () => handleGet(req, context, id))
);

export const PATCH = createContextParamsHandler<{ id: string }>(async (req, context, { id }) =>
  dispatchAction(req, { 'set-model': () => handleSetModel(req, context, id) }, () => handleRename(req, context, id))
);

export const POST = createContextParamsHandler<{ id: string }>(async (req, context, { id }) =>
  dispatchAction(req, {
    keep: () => handleKeep(req, context, id),
    try: () => handleTry(req, context, id),
    discard: () => handleDiscard(req, context, id),
  })
);

// No actions on DELETE: an unknown `?action=` is a 400, never a deleted conversation.
export const DELETE = createContextParamsHandler<{ id: string }>(async (req, context, { id }) =>
  dispatchAction(req, {}, () => handleDelete(req, context, id))
);
