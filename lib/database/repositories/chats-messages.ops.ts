/**
 * Chat Messages Operations
 *
 * Handles message CRUD for chats: get, add, add-many, update,
 * count, and clear. Also exports the ChatMessageRowSchema
 * used for SQLite collection initialization.
 */

import { z } from 'zod';
import {
  ChatMetadata,
  ChatEvent,
  ChatEventSchema,
  DangerFlagSchema,
} from '@/lib/schemas/types';
import { UUIDSchema, TimestampSchema, JsonSchema, RoleEnum } from '@/lib/schemas/common.types';
import { QueryFilter, SortSpec } from '../interfaces';
import { logger } from '@/lib/logger';
import { ChatOpsContext } from './chats-ops-context';
import { safeQuery } from './safe-query';
import {
  computeSpokenThisCycleAfterMessage,
  computeCycleOrderAfterMessage,
} from '@/lib/chat/turn-manager';
import {
  isCharacterAuthoredMessage,
  CHARACTER_AUTHORED_MESSAGE_FILTER,
} from '@/lib/chat/chat-activity';
import { publishRealtime } from '@/lib/realtime/bus';

/**
 * Schema for individual chat message rows in SQLite
 * This schema represents the flattened message format with chatId added
 * for the normalized SQLite storage pattern
 */
export const ChatMessageRowSchema = z.object({
  id: UUIDSchema,
  chatId: UUIDSchema,
  type: z.string(),  // 'message', 'context-summary', or 'system'
  role: RoleEnum.nullable().optional(),  // Only for type='message'
  content: z.string().nullable().optional(),  // For type='message'
  rawResponse: JsonSchema.nullable().optional(),  // JSON object
  tokenCount: z.number().nullable().optional(),
  promptTokens: z.number().nullable().optional(),
  completionTokens: z.number().nullable().optional(),
  swipeGroupId: z.string().nullable().optional(),
  swipeIndex: z.number().nullable().optional(),
  attachments: z.array(UUIDSchema).nullable().default([]),  // JSON array
  debugMemoryLogs: z.array(z.string()).nullable().optional(),  // JSON array
  thoughtSignature: z.string().nullable().optional(),
  // Reasoning / chain-of-thought from thinking models. DISPLAY ONLY — never re-fed to any model.
  reasoningContent: z.string().nullable().optional(),
  // Positioned reasoning blocks (JSON array) for splicing thinking into the prose. DISPLAY ONLY.
  reasoningSegments: z.array(z.object({
    anchorOffset: z.number(),
    content: z.string(),
    seq: z.number(),
  })).nullable().optional(),
  participantId: UUIDSchema.nullable().optional(),
  recoveryType: z.enum(['token_limit', 'token_limit_static', 'content_limit', 'content_limit_static']).nullable().optional(),
  // Server-side pre-rendered HTML for simple messages
  renderedHtml: z.string().nullable().optional(),
  // Danger content flags from gatekeeper classification
  dangerFlags: z.array(DangerFlagSchema).nullable().optional(),  // JSON array
  // Answer-confirmation results. Plain booleans so the schema translator
  // classifies them as boolean columns (INTEGER 0/1 in SQLite, hydrated back to
  // true/false on read — they don't start with 'is' so the naming fallback
  // wouldn't catch them).
  confirmed: z.boolean().nullable().optional(),
  confirmationChecked: z.boolean().nullable().optional(),
  confirmationRevised: z.boolean().nullable().optional(),
  confirmationNotes: z.string().nullable().optional(),
  confirmationOriginalContent: z.string().nullable().optional(),
  targetParticipantIds: z.array(UUIDSchema).nullable().optional(),  // JSON array — whisper targets
  isSilentMessage: z.union([z.boolean(), z.number().transform(v => v === 1)]).nullable().optional(),  // Whether message was generated while character was in silent mode (SQLite stores as 0/1)
  systemSender: z.enum(['lantern', 'aurora', 'librarian', 'concierge', 'prospero', 'host', 'commonplaceBook', 'ariel', 'carina', 'suparna', 'pascal']).nullable().optional(),  // Personified feature that authored this message in lieu of a participant
  systemKind: z.string().nullable().optional(),  // Sub-classification of a Staff-authored message (e.g. 'timestamp', 'project-context', 'memory-recap'). Always paired with systemSender.
  // Neutral, persona-free rewrite of `content` for Staff-authored messages.
  // Swapped into every character's LLM context when the chat has any non-user-
  // character participant with systemTransparency !== true. NULL on
  // participant-authored messages and on legacy Staff messages from before
  // the dual-body migration.
  opaqueContent: z.string().nullable().optional(),
  // Structured payload on Host announcements. Two shapes share this field:
  // (a) presence transitions — { participantId, toStatus } — for add/remove/
  // status-change. (b) off-scene character introductions — { introducedCharacterIds }
  // — stamped by the off-scene Host announcer so the context builder can
  // detect already-introduced characters. All fields optional; NULL on
  // announcements with no structured payload and on every non-Host message.
  hostEvent: z.object({
    participantId: UUIDSchema.optional(),
    toStatus: z.enum(['active', 'silent', 'absent', 'removed']).optional(),
    introducedCharacterIds: z.array(UUIDSchema).optional(),
  }).nullable().optional(),
  // Ad-hoc announcer metadata for user-authored announcement bubbles
  // (Insert Announcement composer button). Mutually exclusive with
  // systemSender. Shape: { kind: 'character', characterId } or
  // { kind: 'custom', displayName }.
  customAnnouncer: z.object({
    kind: z.enum(['character', 'custom']),
    characterId: UUIDSchema.nullable().optional(),
    displayName: z.string().nullable().optional(),
  }).nullable().optional(),
  // Carina (inline LLM queries) provenance, set on systemSender='carina'
  // messages. answererId = workspace character id of the answerer (drives
  // avatar resolution + prior-exchange continuity); question = the verbatim
  // text asked. NULL on every non-Carina message.
  carinaMeta: z.object({
    answererId: UUIDSchema,
    question: z.string(),
  }).nullable().optional(),
  // Pascal the Croupier (custom pseudo-tools) roll record, set on
  // systemSender='pascal' messages. The server rolled and the server picked the
  // outcome, so none of this is the model's account of its own luck.
  // This row schema describes what is STORED; the gate on the way in is
  // ChatEventSchema (lib/schemas/chat.types.ts), which addMessage parses
  // against — a field declared there but not here still persists, since this
  // shape only tells the backend that pascalMeta is a JSON column. Kept in
  // lockstep anyway: it is the account of the column a reader will consult.
  // toolTitle = display title at roll time (absent on older rows; readers fall
  // back to `tool`);
  // definitionTier/definitionMountId = the store the definition resolved from
  // (tiers shadow, so a name can differ per room); rollForm = 'range' or 'dice'
  // ('dice' carries notation + diceRolls); raw = untransformed roll, value =
  // what the outcome table tested; outcomeIndex/state = the winning entry and
  // its verdict; invokedBy = model reach vs. user Run-Tool. NULL on every
  // non-Pascal message.
  pascalMeta: z.object({
    tool: z.string(),
    toolTitle: z.string().optional(),
    // chipLabel = the definition's chipLabel template rendered at roll time —
    // the per-run label the Salon chip and the bubble heading share. Absent on
    // older rows; readers fall back to toolTitle, then tool.
    chipLabel: z.string().optional(),
    definitionTier: z.enum(['character', 'participant', 'group', 'project', 'global']),
    definitionMountId: z.string(),
    params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
    rollForm: z.enum(['range', 'dice']),
    notation: z.string().optional(),
    raw: z.number(),
    diceRolls: z.array(z.number()).optional(),
    value: z.number(),
    state: z.enum(['success', 'partial', 'failure', 'info']),
    outcomeIndex: z.number(),
    // The metadata keys the winning row tested, and what they held at roll time.
    metadataTested: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
    // The LLM consult, when the definition declared one: the rendered prompt,
    // whether it was answered, and the output the table tested (the model's
    // answer, or the author's errorMessage on failure — `reason` records the
    // technical cause for the operator).
    llm: z.object({
      ok: z.boolean(),
      output: z.string(),
      prompt: z.string(),
      reason: z.string().optional(),
      provider: z.string().optional(),
      model: z.string().optional(),
    }).optional(),
    // The side effects this run applied (the audit of the definition's
    // `effects` array): raw target, prior value (absent when none), what was
    // written, and — state targets only — the tier the write landed in.
    effects: z.array(z.object({
      target: z.string(),
      previous: z.unknown().optional(),
      next: z.unknown(),
      tier: z.enum(['chat', 'project', 'group', 'general']).optional(),
    })).optional(),
    invokedBy: z.enum(['llm', 'user']),
    callerParticipantId: UUIDSchema.optional(),
  }).nullable().optional(),
  // The route trail: every connection profile tried for this turn, in order,
  // with why each one stepped aside. NULL unless the turn had at least one
  // failure — a one-entry trail says nothing provider/modelName don't.
  // This row schema describes what is STORED; the gate on the way in is
  // ChatEventSchema (lib/schemas/chat.types.ts), which addMessage parses
  // against — a field declared there but not here still persists, since this
  // shape only tells the backend that routeTrail is a JSON column. Kept in
  // lockstep anyway: it is the account of the column a reader will consult.
  // via = how the profile came to be asked; outcome = 'answered' | 'failed'
  // (fell over on its own) | 'refused' (declined on content grounds);
  // trigger = the engine's failure class; evidence = how a refusal was
  // established ('finish-reason' stated by the provider, 'inferred' from an
  // empty body on a Concierge-flagged turn); detail = a short reason, capped
  // at 200 chars, never the full error body. The last entry always agrees with
  // this row's provider/modelName. ASSISTANT rows only.
  routeTrail: z.array(z.object({
    profileId: UUIDSchema,
    profileName: z.string(),
    provider: z.string(),
    modelName: z.string(),
    via: z.enum(['primary', 'retry', 'concierge', 'understudy', 'tier-pick']),
    outcome: z.enum(['answered', 'failed', 'refused']),
    trigger: z.enum(['auth', 'rate-limit', 'network', 'model-missing', 'provider-error', 'empty-response', 'moderation-refusal']).optional(),
    evidence: z.enum(['finish-reason', 'inferred']).optional(),
    detail: z.string().max(200).optional(),
  })).nullable().optional(),
  // The Courier: when non-null, this row is a placeholder for a manual /
  // clipboard turn awaiting a pasted reply. Cleared on resolve.
  pendingExternalPrompt: z.string().nullable().optional(),
  // Full-context fallback alongside `pendingExternalPrompt` when delta mode
  // rendered a delta. Lets the bubble toggle to the full version.
  pendingExternalPromptFull: z.string().nullable().optional(),
  pendingExternalAttachments: z.array(z.object({
    fileId: UUIDSchema,
    filename: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number(),
    downloadUrl: z.string(),
  })).nullable().optional(),
  // Phase 3c: anchor tying a Staff-authored whisper to the compaction
  // generation under which it was produced. Set on per-character Librarian
  // summary whispers; null on every other message.
  summaryAnchor: z.object({
    compactionGeneration: z.number(),
  }).nullable().optional(),
  // For type='context-summary'
  context: z.string().nullable().optional(),
  // For type='system'
  systemEventType: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  totalTokens: z.number().nullable().optional(),
  provider: z.string().nullable().optional(),
  modelName: z.string().nullable().optional(),
  estimatedCostUSD: z.number().nullable().optional(),
  createdAt: TimestampSchema,
});

export class ChatMessagesOps {
  constructor(private readonly ctx: ChatOpsContext) {}

  /**
   * Count only messages that appear as visible bubbles in the UI
   * (type === 'message' with USER or ASSISTANT role, excluding SYSTEM and TOOL)
   */
  private countVisibleMessages(messages: ChatEvent[]): number {
    return messages.filter(m => m.type === 'message' && m.role !== 'SYSTEM' && m.role !== 'TOOL').length;
  }

  /**
   * Announce that this chat's transcript changed.
   *
   * The single announcement point, and two halves that must never drift apart:
   * an atomic bump of the chat's `transcriptVersion` — the counter an open
   * Salon tab hands back so the server can answer "unchanged" without
   * serializing the conversation — and the `{topic:'chats', id}` hint that
   * tells it to ask. Publishing without bumping would be answered "unchanged"
   * and the change would never reach the display.
   *
   * **The bump is a raw `$inc`, and the column is deliberately absent from
   * `ChatMetadataSchema`.** Both halves of that matter. Every repository update
   * rewrites the *whole* validated row from a snapshot it read moments earlier,
   * so a counter carried in the schema could be rewound by any concurrent
   * chat-row write — two messages landing together would leave the counter
   * where a tab that read in between already thinks it is, and the second
   * message would never appear. Zod strips what it does not declare, so no
   * `update` can touch this column and `SET v = v + 1` is the only writer.
   * Read it back with `ChatsRepository.getTranscriptVersion`.
   *
   * `publishRealtime` is a no-op in the forked job child by construction
   * (`lib/realtime/bus.ts`), and a child's buffered `chats.*` writes are
   * replayed by the parent, which is what runs this method — so the hint fires
   * exactly once per change in both worlds, with no double-publish to reason
   * about. (The child's committed write batch announces the same topic from
   * `topicsForWriteBatch`; hints are idempotent and the bus coalesces them.)
   *
   * Public because the funnel is not quite the whole story: the
   * search-and-replace path (`ChatSearchOps.replaceInMessages`) rewrites
   * message rows directly, and a transcript change is a transcript change.
   *
   * @param chatId The chat whose transcript changed.
   */
  async announceTranscriptChange(chatId: string): Promise<void> {
    await safeQuery(async () => {
      const collection = await this.ctx.getCollection();
      await collection.updateOne(
        { id: chatId } as QueryFilter,
        { $inc: { transcriptVersion: 1 } } as never,
      );
      return true;
    }, 'Failed to bump transcript version', { chatId }, false);

    logger.debug('Transcript change announced', { chatId });
    publishRealtime('chats', chatId);
  }

  /**
   * Commit a transcript change: write the chat-row bookkeeping this message
   * write computed, then announce the change.
   *
   * The counter is bumped separately and atomically by
   * {@link announceTranscriptChange}, never folded into `updateData` — see
   * there for why that separation is the point rather than an inefficiency.
   *
   * @param chatId The chat whose transcript changed.
   * @param chat The chat row as already loaded by the caller, or null when it
   *   no longer exists — in which case there is no bookkeeping to write, but
   *   the change is still announced.
   * @param updateData Any other chat-row bookkeeping this write computed
   *   (message count, cycle state, `lastMessageAt`).
   */
  private async commitTranscriptChange(
    chatId: string,
    chat: ChatMetadata | null,
    updateData: Record<string, unknown> = {},
  ): Promise<void> {
    if (chat && Object.keys(updateData).length > 0) {
      await this.ctx.update(chatId, updateData as Partial<ChatMetadata>);
    }
    await this.announceTranscriptChange(chatId);
  }

  /**
   * Get all messages for a chat
   */
  async getMessages(chatId: string): Promise<ChatEvent[]> {
    return safeQuery(async () => {
      const messagesCollection = await this.ctx.getMessagesCollection();

      let rawMessages: any[];

      if (this.ctx.isSQLiteBackend()) {
        // SQLite: Query individual message rows, sorted by createdAt
        rawMessages = await messagesCollection.find(
          { chatId } as QueryFilter,
          { sort: { createdAt: 1 } as SortSpec }
        );
      } else {
        // Legacy data compatibility: Extract from embedded array
        const messagesDoc = await messagesCollection.findOne({ chatId } as QueryFilter);

        if (!messagesDoc) {
          return [];
        }

        rawMessages = (messagesDoc as any).messages || [];
      }

      // Validate each message individually - skip corrupted messages rather than
      // failing the entire chat load
      const validMessages: ChatEvent[] = [];
      for (const msg of rawMessages) {
        const result = ChatEventSchema.safeParse(msg);
        if (result.success) {
          validMessages.push(result.data);
        } else {
          logger.warn('Skipping corrupted chat message', {
            chatId,
            messageId: msg?.id || 'unknown',
            messageType: msg?.type || 'unknown',
            errors: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
          });
        }
      }

      return validMessages;
    }, 'Failed to get messages for chat', { chatId }, []);
  }

  /**
   * Resolve which chat a message belongs to via a direct indexed lookup on the
   * message id — without loading, scanning, or validating any other chat. Used
   * by the per-message API endpoints so locating a message is O(1) instead of
   * loading and Zod-validating every message in every chat in the account.
   *
   * SQLite backend only (the real runtime). On the legacy embedded-array
   * backend messages aren't individually queryable, so this returns null and
   * callers fall through to "not found".
   */
  async findChatIdForMessage(messageId: string): Promise<string | null> {
    return safeQuery(async () => {
      if (!this.ctx.isSQLiteBackend()) {
        return null;
      }
      const messagesCollection = await this.ctx.getMessagesCollection();
      const row = await messagesCollection.findOne({ id: messageId } as QueryFilter);
      return row ? ((row as { chatId?: string }).chatId ?? null) : null;
    }, 'Failed to resolve chat for message', { messageId }, null);
  }

  /**
   * Add a message to a chat
   */
  async addMessage(chatId: string, message: ChatEvent): Promise<ChatEvent> {
    return safeQuery(async () => {
      const validated = ChatEventSchema.parse(message);
      const messagesCollection = await this.ctx.getMessagesCollection();
      const now = this.ctx.getCurrentTimestamp();

      if (this.ctx.isSQLiteBackend()) {
        // SQLite: Insert as individual row with chatId
        await messagesCollection.insertOne({ ...validated, chatId } as any);
      } else {
        // Legacy data compatibility: Push to embedded array
        await messagesCollection.updateOne(
          { chatId } as QueryFilter,
          {
            $push: { messages: validated },
            $set: { updatedAt: now },
          } as any,
        );
      }

      // Update chat metadata. `lastMessageAt` moves only when a *character*
      // posted — see `isCharacterAuthoredMessage`. A Staff announcement is a
      // message row but not conversational activity, and must not resurrect a
      // quiet chat at the top of the list.
      const chat = await this.ctx.findById(chatId);
      const updateData: Record<string, unknown> = {};
      if (chat) {
        const allMessages = await this.getMessages(chatId);
        const isActualMessage = validated.type === 'message';
        updateData.messageCount = this.countVisibleMessages(allMessages);
        if (isCharacterAuthoredMessage(validated)) {
          updateData.lastMessageAt = now;
        }
        if (isActualMessage) {
          updateData.updatedAt = now;
        }
        const cycleUpdate = computeSpokenThisCycleAfterMessage(
          validated,
          chat.participants,
          chat.spokenThisCycleParticipantIds,
        );
        if (cycleUpdate !== null) {
          updateData.spokenThisCycleParticipantIds = cycleUpdate;
        }
        // Strike this speaker from the cycle's drawn rotation. Pure bookkeeping:
        // drawing the next rotation needs talkativeness and happens lazily at
        // the following selection (`resolveCycleOrder`), for which an emptied
        // list is the signal.
        const orderUpdate = computeCycleOrderAfterMessage(
          validated,
          chat.cycleOrderParticipantIds,
        );
        if (orderUpdate !== null) {
          updateData.cycleOrderParticipantIds = orderUpdate;
        }
      }
      await this.commitTranscriptChange(chatId, chat, updateData);
      return validated;
    }, 'Failed to add message to chat', { chatId });
  }

  /**
   * Add multiple messages to a chat
   */
  async addMessages(chatId: string, messages: ChatEvent[]): Promise<ChatEvent[]> {
    return safeQuery(async () => {
      const validated = messages.map(msg => ChatEventSchema.parse(msg));
      const messagesCollection = await this.ctx.getMessagesCollection();
      const now = this.ctx.getCurrentTimestamp();

      if (this.ctx.isSQLiteBackend()) {
        // SQLite: Insert each message as individual row with chatId
        for (const msg of validated) {
          await messagesCollection.insertOne({ ...msg, chatId } as any);
        }
      } else {
        // Legacy data compatibility: Push all to embedded array
        await messagesCollection.updateOne(
          { chatId } as QueryFilter,
          {
            $push: { messages: { $each: validated } },
            $set: { updatedAt: now },
          } as any
        );
      }

      // Update chat metadata. As in `addMessage`: `lastMessageAt` moves only if
      // the batch actually carried character-authored content, while
      // `updatedAt` moves for any message row.
      const chat = await this.ctx.findById(chatId);
      const updateData: Record<string, unknown> = {};
      if (chat) {
        const allMessages = await this.getMessages(chatId);
        const hasActualMessages = validated.some(m => m.type === 'message');
        updateData.messageCount = this.countVisibleMessages(allMessages);
        if (validated.some(isCharacterAuthoredMessage)) {
          updateData.lastMessageAt = now;
        }
        if (hasActualMessages) {
          updateData.updatedAt = now;
        }
        // Fold each message through the cycle helper in order so a batch that
        // wraps the cycle mid-stream still lands on the right final state.
        let currentSpoken = chat.spokenThisCycleParticipantIds;
        let spokenChanged = false;
        let currentOrder = chat.cycleOrderParticipantIds;
        let orderChanged = false;
        for (const msg of validated) {
          const next = computeSpokenThisCycleAfterMessage(msg, chat.participants, currentSpoken);
          if (next !== null) {
            currentSpoken = next;
            spokenChanged = true;
          }
          const nextOrder = computeCycleOrderAfterMessage(msg, currentOrder);
          if (nextOrder !== null) {
            currentOrder = nextOrder;
            orderChanged = true;
          }
        }
        if (spokenChanged) {
          updateData.spokenThisCycleParticipantIds = currentSpoken;
        }
        if (orderChanged) {
          updateData.cycleOrderParticipantIds = currentOrder;
        }
      }
      await this.commitTranscriptChange(chatId, chat, updateData);
      return validated;
    }, 'Failed to add messages to chat', { chatId });
  }

  /**
   * Update a specific message in a chat
   */
  async updateMessage(chatId: string, messageId: string, updates: Partial<ChatEvent>): Promise<ChatEvent | null> {
    return safeQuery(async () => {
      const messagesCollection = await this.ctx.getMessagesCollection();
      const now = this.ctx.getCurrentTimestamp();

      if (this.ctx.isSQLiteBackend()) {
        // SQLite: Find and update the specific message row
        const existingMessage = await messagesCollection.findOne({ id: messageId, chatId } as QueryFilter);
        if (!existingMessage) {
          return null;
        }

        const updatedMessage = { ...existingMessage, ...updates };
        const validated = ChatEventSchema.parse(updatedMessage);

        await messagesCollection.updateOne(
          { id: messageId } as QueryFilter,
          { $set: validated } as any
        );
        // An edited row is a transcript change: swipes, regenerate, a typo fix
        // and a danger reclassification all land here, and an open tab must be
        // told to look again.
        await this.announceTranscriptChange(chatId);
        return validated;
      } else {
        // Legacy data compatibility: Update in embedded array
        const messages = await this.getMessages(chatId);
        const messageIndex = messages.findIndex(m => m.id === messageId);

        if (messageIndex === -1) {
          return null;
        }

        // Merge updates with existing message
        const updatedMessage = { ...messages[messageIndex], ...updates };
        const validated = ChatEventSchema.parse(updatedMessage);

        // Replace message in array
        messages[messageIndex] = validated;

        // Update entire messages array
        await messagesCollection.updateOne(
          { chatId } as QueryFilter,
          {
            $set: {
              messages: messages,
              updatedAt: now,
            },
          } as any
        );
        await this.announceTranscriptChange(chatId);
        return validated;
      }
    }, 'Failed to update message in chat', { chatId, messageId }, null);
  }

  /**
   * Get message count for a chat
   */
  async getMessageCount(chatId: string): Promise<number> {
    return safeQuery(async () => {
      const messages = await this.getMessages(chatId);
      return messages.length;
    }, 'Failed to get message count for chat', { chatId }, 0);
  }

  /**
   * Timestamp of the most recent *played* message in a chat — one a character
   * posted as content, per `isCharacterAuthoredMessage`
   * (`@/lib/chat/chat-activity`), which is THE definition of chat activity and
   * the thing to change if this needs to move. In short: `type === 'message'`,
   * role `USER`/`ASSISTANT`, no `systemSender`, no `customAnnouncer`. Whispers
   * count; Staff announcements, announcement bubbles, and raw tool rows don't.
   *
   * Returns the ISO `createdAt` of that message, or null when the chat has no
   * played messages at all. This is the value mirrored into the chat's
   * `lastMessageAt` column (which every list and sort reads), and the value the
   * stale-chat maintenance sweep uses to decide whether a chat has gone quiet.
   */
  async getLastPlayedMessageAt(chatId: string): Promise<string | null> {
    return safeQuery(async () => {
      const messagesCollection = await this.ctx.getMessagesCollection();

      if (this.ctx.isSQLiteBackend()) {
        // Indexed single-row lookup — avoids loading and Zod-validating the
        // whole transcript of every chat during the daily maintenance sweep.
        const rows = await messagesCollection.find(
          { chatId, ...(CHARACTER_AUTHORED_MESSAGE_FILTER as object) } as QueryFilter,
          { sort: { createdAt: -1 } as SortSpec, limit: 1 },
        );
        const createdAt = (rows[0] as { createdAt?: unknown } | undefined)?.createdAt;
        return typeof createdAt === 'string' ? createdAt : null;
      }

      // Legacy embedded-array backend: scan the loaded messages for the newest
      // character-authored one (ISO-8601 strings compare lexicographically).
      const messages = await this.getMessages(chatId);
      let latest: string | null = null;
      for (const m of messages) {
        if (!isCharacterAuthoredMessage(m)) continue;
        if (latest === null || m.createdAt > latest) latest = m.createdAt;
      }
      return latest;
    }, 'Failed to get last played message timestamp', { chatId }, null);
  }

  /**
   * Delete a specific set of messages from a chat by ID. Returns the number
   * of messages actually removed. Used by the per-character Librarian
   * summary pipeline to sweep prior summary whispers when a fresh one is
   * about to be posted.
   */
  async deleteMessagesByIds(chatId: string, messageIds: string[]): Promise<number> {
    if (messageIds.length === 0) return 0;

    return safeQuery(async () => {
      const messagesCollection = await this.ctx.getMessagesCollection();
      const now = this.ctx.getCurrentTimestamp();
      let removed = 0;

      if (this.ctx.isSQLiteBackend()) {
        for (const messageId of messageIds) {
          const result = await messagesCollection.deleteOne({ id: messageId, chatId } as QueryFilter);
          // deleteOne may return either a count or a boolean depending on backend
          if (typeof result === 'number') {
            removed += result;
          } else if (result) {
            removed += 1;
          }
        }
      } else {
        // Legacy data compatibility: rewrite embedded messages array
        const existing = await this.getMessages(chatId);
        const idSet = new Set(messageIds);
        const remaining = existing.filter(m => !idSet.has(m.id));
        removed = existing.length - remaining.length;
        if (removed > 0) {
          await messagesCollection.updateOne(
            { chatId } as QueryFilter,
            {
              $set: {
                messages: remaining,
                updatedAt: now,
              },
            } as any,
          );
        }
      }

      if (removed > 0) {
        const chat = await this.ctx.findById(chatId);
        const updateData: Record<string, unknown> = {};
        if (chat) {
          const allMessages = await this.getMessages(chatId);
          // Deleting the newest character-authored message must walk
          // `lastMessageAt` *backwards*, not leave it pointing at a row that no
          // longer exists — recompute from what survives.
          updateData.messageCount = this.countVisibleMessages(allMessages);
          updateData.lastMessageAt = await this.getLastPlayedMessageAt(chatId);
        }
        // A swept Commonplace whisper is a transcript change too — the reason
        // the version counter beats a `since=<timestamp>` cursor, which cannot
        // see a deletion at all.
        await this.commitTranscriptChange(chatId, chat, updateData);
        logger.info('Messages deleted from chat', { chatId, removed, requested: messageIds.length });
      }

      return removed;
    }, 'Failed to delete messages from chat', { chatId, count: messageIds.length }, 0);
  }

  /**
   * Clear all messages from a chat
   */
  async clearMessages(chatId: string): Promise<boolean> {
    return safeQuery(async () => {
      const messagesCollection = await this.ctx.getMessagesCollection();
      const now = this.ctx.getCurrentTimestamp();

      if (this.ctx.isSQLiteBackend()) {
        // SQLite: Delete all message rows for this chat
        await messagesCollection.deleteMany({ chatId } as QueryFilter);
      } else {
        // Legacy data compatibility: Clear embedded messages array
        await messagesCollection.updateOne(
          { chatId } as QueryFilter,
          {
            $set: {
              messages: [],
              updatedAt: now,
            },
          } as any,
        );
      }

      // Reset metadata
      const chat = await this.ctx.findById(chatId);
      await this.commitTranscriptChange(chatId, chat, {
        messageCount: 0,
        lastMessageAt: null,
      });

      logger.info('Messages cleared for chat', { chatId });
      return true;
    }, 'Failed to clear messages for chat', { chatId }, false);
  }
}
