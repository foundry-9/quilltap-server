/**
 * Carina (inline LLM queries) — core service.
 *
 * `runCarinaQuery` resolves a designated answerer character and produces a
 * minimal, ISOLATED reference answer:
 *   - system prompt = the answerer's identity stack (NOT the per-turn
 *     `buildSystemPrompt`, which layers in roleplay template / tool
 *     reinforcement) plus their default scenario,
 *   - the answerer's OWN relevant memories, recalled against the question and
 *     whispered in by the Commonplace Book (recall only — still NO general
 *     chat history, NO project or core whispers, NO live conversation),
 *   - prior Carina exchanges for THIS answerer in THIS chat (for follow-up
 *     continuity),
 *   - the question as a user-role message.
 *
 * It has access to the chat's enabled tools (minus `ask_carina`, a recursion
 * guard) and runs the standard detect→execute→re-stream tool loop.
 *
 * v1 runs entirely server-side (no live token streaming): the answer is
 * accumulated, posted as a `systemSender: 'carina'` message, and surfaced to the
 * client by the existing post-turn `fetchChat()` refresh. The `systemSender`
 * tag keeps the answer out of the NORMAL per-turn extraction (see
 * `buildTurnTranscript`); the answerer's memories of the exchange are instead
 * formed through the dedicated `CARINA_MEMORY_EXTRACTION` job enqueued after the
 * answer posts. Failures are RETURNED (never thrown) so the caller can route
 * them through Prospero.
 */

import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import { buildIdentityStack } from '@/lib/chat/context/system-prompt-builder';
import {
  buildTools,
  streamMessage,
  type StreamOptions,
} from '@/lib/services/chat-message/streaming.service';
import {
  processToolCalls,
  detectToolCallsInResponse,
  createToolContext,
  type StreamController,
} from '@/lib/services/chat-message/tool-execution.service';
import { supportsCapability } from '@/lib/plugins/provider-registry';
import { searchMemoriesSemantic } from '@/lib/memory/memory-service';
import { formatMemoriesForContext } from '@/lib/chat/context/memory-injector';
import { buildCommonplaceLLMContext } from '@/lib/services/commonplace-notifications/writer';
import { enqueueCarinaMemoryExtraction } from '@/lib/background-jobs/queue-service';
import { postCarinaResponse } from './writer';
import type { CarinaResult } from './carina.types';
import type { Character, ConnectionProfile } from '@/lib/schemas/types';

/** Maximum detect→execute→re-stream iterations within a single Carina answer. */
const MAX_TOOL_ITERATIONS = 5;

/** Token budget for the answerer's recalled memories injected into the call. */
const CARINA_MEMORY_TOKEN_BUDGET = 1200;
/** Upper bound on how many recalled memories to consider for the budget. */
const CARINA_MEMORY_LIMIT = 12;
/** Floor on memory importance for Carina recall (mirrors the per-turn head). */
const CARINA_MEMORY_MIN_IMPORTANCE = 0.3;

export interface RunCarinaQueryOptions {
  userId: string;
  chatId: string;
  /** Answerer name as written in the markup / tool call. */
  characterName: string;
  /** The question to answer. */
  question: string;
  /** `?` separator / `whisper: true` → answer is whispered to the asker only. */
  whisper: boolean;
  /**
   * Participant id of the asker — the user's participant for `@Name?` markup, or
   * the calling character's participant for `ask_carina`. Used as the whisper
   * target. null when no participant context is available (answer goes public).
   */
  askerParticipantId: string | null;
}

/** Resolve the answerer's default scenario content, if any. */
function resolveDefaultScenario(character: Character): string | null {
  const scenarios = character.scenarios ?? [];
  if (!scenarios.length) return null;
  if (character.defaultScenarioId) {
    const found = scenarios.find((s) => s.id === character.defaultScenarioId);
    if (found?.content) return found.content;
  }
  return scenarios[0]?.content ?? null;
}

/**
 * Replay prior Carina exchanges for this answerer in this chat as alternating
 * user(question)/assistant(answer) pairs — gives "And what about…?" follow-ups
 * continuity without pulling in the full conversation.
 */
async function loadPriorCarinaExchanges(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  answererId: string,
): Promise<StreamOptions['messages']> {
  const pairs: StreamOptions['messages'] = [];
  try {
    const all = await repos.chats.getMessages(chatId);
    for (const m of all) {
      if (m.type !== 'message') continue;
      if (m.systemSender !== 'carina') continue;
      if (m.systemKind !== 'carina-response') continue;
      const meta = m.carinaMeta;
      if (!meta || meta.answererId !== answererId) continue;
      pairs.push({ role: 'user', content: meta.question });
      pairs.push({ role: 'assistant', content: m.content });
    }
  } catch (error) {
    logger.warn('[Carina] Failed to load prior exchanges; proceeding without continuity', {
      context: 'carina',
      chatId,
      answererId,
      error: getErrorMessage(error),
    });
  }
  return pairs;
}

/**
 * Recall the answerer's own memories that bear on the question and render them
 * as a plain "you remember…" context block — the Commonplace Book whispering
 * into the isolated call. The semantic search runs over the answerer's whole
 * memory store, so it naturally surfaces what they know about anyone the
 * question touches, without pulling in the live conversation.
 *
 * Returns null (and never throws) when there is nothing to recall or the lookup
 * fails — a memory miss must never block a reference answer.
 */
async function loadCarinaMemoryRecall(
  characterId: string,
  question: string,
  userId: string,
  provider: ConnectionProfile['provider'],
  chatId: string,
): Promise<string | null> {
  const trimmed = question.trim();
  if (!trimmed) return null;
  try {
    const results = await searchMemoriesSemantic(characterId, trimmed, {
      userId,
      // Always the default embedding profile, as the per-turn recall does.
      embeddingProfileId: undefined,
      limit: CARINA_MEMORY_LIMIT,
      minImportance: CARINA_MEMORY_MIN_IMPORTANCE,
    });
    if (results.length === 0) return null;

    const formatted = formatMemoriesForContext(results, CARINA_MEMORY_TOKEN_BUDGET, provider);
    if (!formatted.content || formatted.memoriesUsed === 0) return null;

    logger.debug('[Carina] Recalled memories for reference answer', {
      context: 'carina',
      chatId,
      characterId,
      memoriesUsed: formatted.memoriesUsed,
    });
    return buildCommonplaceLLMContext({ relevant: formatted.content });
  } catch (error) {
    logger.warn('[Carina] Memory recall failed; answering without it', {
      context: 'carina',
      chatId,
      characterId,
      error: getErrorMessage(error),
    });
    return null;
  }
}

/**
 * Resolve the answerer's connection profile via Carina's own chain (NOT the
 * participant-scoped `resolveConnectionProfile`):
 *   1. the answerer's default profile,
 *   2. the instance default profile,
 *   3. the first profile whose provider supports native web search,
 *   4. null (→ no-profile error).
 */
async function resolveCarinaProfile(
  repos: ReturnType<typeof getRepositories>,
  userId: string,
  character: Character,
): Promise<ConnectionProfile | null> {
  if (character.defaultConnectionProfileId) {
    const byChar = await repos.connections.findById(character.defaultConnectionProfileId);
    if (byChar) return byChar;
  }
  const instanceDefault = await repos.connections.findDefault(userId);
  if (instanceDefault) return instanceDefault;
  const all = await repos.connections.findByUserId(userId);
  return all.find((p) => supportsCapability(p.provider, 'webSearch')) ?? null;
}

export async function runCarinaQuery(opts: RunCarinaQueryOptions): Promise<CarinaResult> {
  const { userId, chatId, characterName, question, whisper, askerParticipantId } = opts;
  const repos = getRepositories();

  // 1. Resolve answerer by name (case-insensitive) among `canBeCarina` characters.
  const wanted = characterName.trim().toLowerCase();
  const candidates = await repos.characters.findByUserId(userId);
  const answerer =
    candidates
      .filter((c) => c.canBeCarina === true && c.name.trim().toLowerCase() === wanted)
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))[0] ?? null;

  if (!answerer) {
    logger.info('[Carina] No answerer found', { context: 'carina', chatId, characterName });
    return { ok: false, error: { kind: 'not-found', characterName } };
  }

  try {
    // 2. Resolve connection profile (custom chain) + API key.
    const connectionProfile = await resolveCarinaProfile(repos, userId, answerer);
    if (!connectionProfile) {
      logger.info('[Carina] No connection profile resolvable', {
        context: 'carina',
        chatId,
        answererId: answerer.id,
      });
      return { ok: false, error: { kind: 'no-profile', characterName: answerer.name } };
    }

    let apiKey = '';
    if (connectionProfile.apiKeyId) {
      const apiKeyData = await repos.connections.findApiKeyById(connectionProfile.apiKeyId);
      if (apiKeyData) apiKey = apiKeyData.key_value;
    }

    // 3. Load the chat for its tool slate + image profile.
    const chat = await repos.chats.findById(chatId);
    if (!chat) {
      return { ok: false, error: { kind: 'llm-failed', detail: 'chat not found', characterName: answerer.name } };
    }

    // 4. Build the minimal, isolated context.
    const scenarioText = resolveDefaultScenario(answerer);
    let systemPrompt = buildIdentityStack({
      character: answerer,
      userCharacter: null,
      selectedSystemPromptId: answerer.defaultSystemPromptId ?? null,
      scenarioText,
    });
    if (scenarioText) {
      systemPrompt += `\n\n## Scenario\n${scenarioText}`;
    }
    systemPrompt +=
      '\n\n## Reference Query\nYou are being consulted for a quick, standalone question. ' +
      'Answer it directly and concisely from your own knowledge and the tools available to you. ' +
      'You do not have the surrounding conversation in view.';

    // The Commonplace Book whispers the answerer's own relevant memories into
    // the call (recall only — still no live conversation context).
    const memoryRecall = await loadCarinaMemoryRecall(
      answerer.id,
      question,
      userId,
      connectionProfile.provider,
      chatId,
    );
    if (memoryRecall) {
      systemPrompt += `\n\n${memoryRecall}`;
    }

    const priorExchanges = await loadPriorCarinaExchanges(repos, chatId, answerer.id);
    let currentMessages: StreamOptions['messages'] = [
      { role: 'system', content: systemPrompt },
      ...priorExchanges,
      { role: 'user', content: question },
    ];

    // 5. Build the chat's tool slate, minus `ask_carina` (recursion guard).
    const imageProfileId = chat.imageProfileId ?? null;
    let imageProfile = null;
    if (imageProfileId) {
      try {
        imageProfile = await repos.imageProfiles.findById(imageProfileId);
      } catch {
        imageProfile = null;
      }
    }
    const charParticipants = (chat.participants ?? []).filter((p) => p.type === 'CHARACTER');
    const isMultiCharacter = charParticipants.length > 1;
    let documentEditingEnabled = false;
    if (chat.projectId) {
      try {
        const mountLinks = await repos.projectDocMountLinks.findByProjectId(chat.projectId);
        documentEditingEnabled = mountLinks.length > 0;
      } catch {
        /* leave disabled on lookup failure */
      }
    }

    const built = await buildTools(
      connectionProfile,
      imageProfileId,
      imageProfile,
      userId,
      chat.projectId ?? undefined,
      false, // requestFullContext
      chat.disabledTools ?? [],
      chat.disabledToolGroups ?? [],
      false, // agentModeEnabled
      isMultiCharacter,
      answerer.defaultHelpToolsEnabled === true, // helpToolsEnabled
      false, // canDressThemselves — Carina does not dress the answerer
      false, // canCreateOutfits
      documentEditingEnabled,
    );
    const tools = built.tools.filter((t) => {
      const name =
        (t as { function?: { name?: string }; name?: string }).function?.name ??
        (t as { name?: string }).name;
      return name !== 'ask_carina';
    });
    const useNativeWebSearch = built.useNativeWebSearch;
    const modelParams = (connectionProfile.parameters ?? {}) as Record<string, unknown>;

    // 6. Run the LLM call + tool loop server-side (no live client streaming).
    const sink: StreamController = { enqueue: () => {} };
    const encoder = new TextEncoder();
    const answererParticipantId = charParticipants.find((p) => p.characterId === answerer.id)?.id ?? null;
    const toolContext = createToolContext(
      chatId,
      userId,
      answerer.id,
      answererParticipantId ?? '',
      imageProfileId,
      undefined,
      chat.projectId ?? null,
    );

    let answer = '';
    let rawResponse: unknown = null;

    for await (const chunk of streamMessage({
      messages: currentMessages,
      connectionProfile,
      apiKey,
      modelParams,
      tools,
      useNativeWebSearch,
      userId,
      chatId,
      characterId: answerer.id,
    })) {
      if (chunk.content) answer += chunk.content;
      if (chunk.done) rawResponse = chunk.rawResponse;
    }

    let iterations = 0;
    while (rawResponse && iterations < MAX_TOOL_ITERATIONS) {
      const toolCalls = detectToolCallsInResponse(rawResponse, connectionProfile.provider);
      if (toolCalls.length === 0) break;
      iterations++;

      const results = await processToolCalls(toolCalls, toolContext, sink, encoder, {
        characterName: answerer.name,
        characterId: answerer.id,
      });

      const hasCallIds = toolCalls.some((tc) => tc.callId);
      const assistantToolCalls = hasCallIds
        ? toolCalls
            .filter((tc) => tc.callId)
            .map((tc) => ({
              id: tc.callId!,
              type: 'function' as const,
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
            }))
        : undefined;

      currentMessages = [
        ...currentMessages,
        {
          role: 'assistant',
          content: answer && answer.trim().length ? answer : '',
          toolCalls: assistantToolCalls,
        },
      ];
      for (const tm of results.toolMessages) {
        if (tm.callId) {
          currentMessages.push({ role: 'tool', content: tm.content, toolCallId: tm.callId, name: tm.toolName });
        } else {
          currentMessages.push({ role: 'user', content: `[Tool Result: ${tm.toolName}]\n${tm.content}` });
        }
      }

      answer = '';
      rawResponse = null;
      for await (const chunk of streamMessage({
        messages: currentMessages,
        connectionProfile,
        apiKey,
        modelParams,
        tools,
        useNativeWebSearch,
        userId,
        chatId,
        characterId: answerer.id,
      })) {
        if (chunk.content) answer += chunk.content;
        if (chunk.done) rawResponse = chunk.rawResponse;
      }
    }

    const finalAnswer = answer.trim();
    if (!finalAnswer) {
      return { ok: false, error: { kind: 'llm-failed', detail: 'empty response', characterName: answerer.name } };
    }

    // 7. Post the answer. The systemSender:'carina' tag keeps it out of the
    // NORMAL per-turn extraction; the answerer's own memories are formed
    // instead via the dedicated CARINA_MEMORY_EXTRACTION job below.
    const posted = await postCarinaResponse({
      chatId,
      answer: finalAnswer,
      answererId: answerer.id,
      question,
      participantId: answererParticipantId,
      whisper,
      askerParticipantId,
    });
    if (!posted) {
      return {
        ok: false,
        error: { kind: 'llm-failed', detail: 'failed to persist answer', characterName: answerer.name },
      };
    }

    // 8. Form the answerer's SELF memories from this exchange, off the hot
    // path. Whispered and public answers alike are remembered — the exchange
    // happened to the answerer regardless of who could see it. A failure to
    // enqueue must never undo a posted answer.
    try {
      await enqueueCarinaMemoryExtraction(userId, {
        chatId,
        carinaMessageId: posted.id,
        answererId: answerer.id,
        connectionProfileId: connectionProfile.id,
      });
    } catch (error) {
      logger.warn('[Carina] Failed to enqueue memory extraction; answer stands', {
        context: 'carina',
        chatId,
        answererId: answerer.id,
        error: getErrorMessage(error),
      });
    }

    logger.info('[Carina] Query answered', {
      context: 'carina',
      chatId,
      answererId: answerer.id,
      whisper,
      toolIterations: iterations,
      answerLength: finalAnswer.length,
    });

    return {
      ok: true,
      answer: finalAnswer,
      messageId: posted.id,
      message: posted,
      answererId: answerer.id,
      answererName: answerer.name,
    };
  } catch (error) {
    logger.error(
      '[Carina] Query failed',
      { context: 'carina', chatId, characterName, error: getErrorMessage(error) },
      error as Error,
    );
    return { ok: false, error: { kind: 'llm-failed', detail: getErrorMessage(error), characterName: answerer.name } };
  }
}
