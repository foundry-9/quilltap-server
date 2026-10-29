/**
 * Operator intervention must never reach a model (spec 1.4 and 5.1).
 *
 * (a) The definition's `intervention` block and the `intervene` flags are the
 *     operator's business: no model-facing projection of a definition may
 *     mention them, nor the word "intervention".
 * (b) A Pascal message that was held and adjusted carries `pascalMeta.intervention`
 *     (the run as first dealt). Every model-facing transcript path reads
 *     `content`, never `pascalMeta`; these feed such a message through each
 *     path and assert the dealt values and the word "adjusted" stay out while
 *     the final `content` gets in.
 *
 * Coverage notes. `buildMessageContext` itself needs a whole chat environment,
 * so the narrowest path on it is exercised: `isRecordOnlyMessage` →
 * `normalizeWhisperRoles` → `buildConversationMessages`, the three steps that
 * turn stored events into the history. The Courier is exercised through
 * `dispatchCourierTransport`'s delta builder (the one Courier path that reads
 * raw events); the full-bundle path takes the already-built context. The
 * storyteller bid roster is reached through `buildBidOffer` / `buildBidSection`.
 */

import { buildRunCustomDescription } from '@/lib/tools/run-custom-tool';
import { collectToolVocabulary } from '@/lib/pascal/tool-vocabulary';
import { QtapCustomToolSchema, type QtapCustomTool } from '@/lib/pascal/custom-tool.types';
import type { DiscoveredCustomTool } from '@/lib/pascal/custom-tools';
import { buildBidOffer } from '@/lib/storyteller/bid-call';
import { buildBidSection } from '@/lib/storyteller/prompts';
import {
  buildConversationMessages,
  isRecordOnlyMessage,
  normalizeWhisperRoles,
} from '@/lib/services/chat-message/context-builder.service';
import { extractVisibleConversation } from '@/lib/memory/cheap-llm-tasks/chat-tasks';
import { renderConversationMarkdown } from '@/lib/scriptorium/markdown-renderer';

const mockRenderCourierDeltaAsMarkdown = jest.fn();

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

jest.mock('@/lib/llm/courier/render-markdown', () => ({
  renderCourierRequestAsMarkdown: jest.fn(() => ({ markdown: '', attachments: [] })),
  renderCourierDeltaAsMarkdown: (...args: unknown[]) => mockRenderCourierDeltaAsMarkdown(...args),
}));

jest.mock('@/lib/services/chat-message/streaming.service', () => ({
  safeEnqueue: (controller: { enqueue: (chunk: unknown) => void }, chunk: unknown) => controller.enqueue(chunk),
  encodeDoneEvent: (_encoder: TextEncoder, payload: unknown) => ({ done: payload }),
  encodePendingExternalTurnEvent: (_encoder: TextEncoder, payload: unknown) => ({ pending: payload }),
}));

const { dispatchCourierTransport } = require('@/lib/services/chat-message/courier-transport.service') as
  typeof import('@/lib/services/chat-message/courier-transport.service');

// ---------------------------------------------------------------------------
// (a) The definition
// ---------------------------------------------------------------------------

function intervenableDefinition(): QtapCustomTool {
  const parsed = QtapCustomToolSchema.safeParse({
    name: 'wager',
    description: 'A modest wager.',
    roll: { min: 0, max: 100 },
    revealOdds: true,
    parameters: {
      bonus: { type: 'number', default: 0, min: 0, max: 10, description: 'Added to the roll.' },
      locked: { type: 'number', default: 0, intervene: false },
    },
    effects: [
      { target: 'state.wins', value: 1, intervene: false },
      { when: { outcome: { eq: 'success' } }, target: 'metadata.lastWin', value: true },
    ],
    outcomes: [
      { when: { gte: 50 }, message: 'The house pays out.', state: 'success' },
      { when: true, message: 'The house keeps it.', state: 'failure' },
    ],
    intervention: { enabled: true, fields: { roll: false } },
  });
  if (!parsed.success) {
    throw new Error(`fixture invalid: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }
  return parsed.data;
}

function discovered(definition: QtapCustomTool): DiscoveredCustomTool {
  return {
    definition,
    tier: 'global',
    definitionPath: 'tools/wager.tool.json',
    mountPointId: 'mount-1',
    mountName: 'Quilltap Tools',
  } as DiscoveredCustomTool;
}

/** A leak is the key, the flag or the word, in any case, anywhere in the text. */
function expectNoInterventionTalk(text: string): void {
  expect(text).not.toMatch(/intervention/i);
  expect(text).not.toMatch(/intervene/i);
}

describe('model-facing projections of an intervenable definition', () => {
  const definition = intervenableDefinition();

  it('the fixture really is intervenable (a control for the assertions below)', () => {
    expect(definition.intervention).toEqual({ enabled: true, fields: { roll: false } });
    expect(JSON.stringify(definition)).toMatch(/intervene/);
  });

  it('run_custom description says nothing about intervention (odds revealed)', () => {
    const text = buildRunCustomDescription([discovered(definition)]);
    expect(text).toContain('wager');
    expect(text).toContain('Side effects:');
    expectNoInterventionTalk(text);
  });

  it('run_custom description says nothing about intervention (odds hidden)', () => {
    const hidden = { ...definition, revealOdds: false } as QtapCustomTool;
    const text = buildRunCustomDescription([discovered(hidden)]);
    expect(text).toContain('wager');
    expectNoInterventionTalk(text);
  });

  it('the tool vocabulary carries no intervention keys', () => {
    expectNoInterventionTalk(JSON.stringify(collectToolVocabulary(definition)));
  });

  it("the storyteller bid roster names the tool without a word of the operator's controls", () => {
    const offer = buildBidOffer({
      tools: [{ function: { name: 'run_custom' } }],
      customToolEffects: new Map([[definition.name, 'write' as const]]),
      pluginToolEffects: new Map(),
      silent: false,
    });
    expect(offer.customTools).toEqual({ wager: 'write' });
    expectNoInterventionTalk(JSON.stringify(offer));
    const section = buildBidSection({ characterName: 'Ada', talkativeness: 0.5, offer });
    expect(section).toContain('run_custom:<name>');
    expect(section).toContain('wager');
    expectNoInterventionTalk(section);
  });
});

// ---------------------------------------------------------------------------
// (b) The record
// ---------------------------------------------------------------------------

const DEALT_MESSAGE = 'DEALT-SECRET-MESSAGE';
const DEALT_RAW = 0.123456;
const FINAL_CONTENT = 'The house pays out at seventy.';

/** A Pascal outcome as `postPascalResult` stores it, adjusted by the operator. */
function adjustedPascalMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-pascal',
    type: 'message',
    role: 'ASSISTANT',
    participantId: null,
    createdAt: '2026-05-02T00:00:00.000Z',
    content: FINAL_CONTENT,
    opaqueContent: FINAL_CONTENT,
    attachments: [],
    targetParticipantIds: null,
    systemSender: 'pascal',
    systemKind: 'custom-tool-result',
    pascalMeta: {
      tool: 'wager',
      definitionTier: 'global',
      definitionMountId: 'mount-1',
      params: { bonus: 4 },
      rollForm: 'range',
      raw: 0.7,
      value: 70,
      state: 'success',
      outcomeIndex: 0,
      invokedBy: 'llm',
      intervention: {
        resolvedAt: '2026-05-02T00:00:00.000Z',
        decision: 'deal',
        changed: ['params.bonus', 'outcome'],
        dealt: {
          params: { bonus: 0 },
          raw: DEALT_RAW,
          value: DEALT_RAW * 100,
          outcomeIndex: 1,
          state: 'failure',
          message: DEALT_MESSAGE,
          chipLabel: 'DEALT-SECRET-CHIP',
          visibility: 'public',
          announcer: 'pascal',
          llm: { ok: true, output: 'DEALT-SECRET-ORACLE', prompt: 'DEALT-SECRET-PROMPT' },
        },
        reasks: 2,
      },
    },
    ...overrides,
  };
}

const SECRETS = [DEALT_MESSAGE, String(DEALT_RAW), 'DEALT-SECRET-CHIP', 'DEALT-SECRET-ORACLE', 'DEALT-SECRET-PROMPT'];

function expectNoRecord(text: string): void {
  for (const secret of SECRETS) expect(text).not.toContain(secret);
  expect(text).not.toMatch(/adjusted/i);
  expectNoInterventionTalk(text);
}

describe('a held-and-adjusted Pascal message never reaches a model', () => {
  const messages = [
    { id: 'u1', type: 'message', role: 'USER', content: 'Roll for it.', createdAt: '2026-05-01T00:00:00.000Z' },
    adjustedPascalMessage(),
  ];

  it('the fixture carries the dealt values (a control)', () => {
    expect(JSON.stringify(messages)).toContain(DEALT_MESSAGE);
  });

  describe('buildMessageContext path (strip → normalise → conversation)', () => {
    for (const opaque of [false, true]) {
      it(`${opaque ? 'opaque' : 'transparent'} roster`, () => {
        const kept = messages.filter((m) => !isRecordOnlyMessage(m));
        const normalised = normalizeWhisperRoles(kept as never, opaque);
        const { conversationMessages } = buildConversationMessages(normalised as never, false);
        const text = JSON.stringify(conversationMessages);

        expect(text).toContain(FINAL_CONTENT);
        expectNoRecord(text);
      });
    }

    it('in a multi-character room too', () => {
      const normalised = normalizeWhisperRoles(messages as never, false);
      const { conversationMessages, messagesWithParticipants } = buildConversationMessages(
        normalised as never,
        true
      );
      const text = JSON.stringify({ conversationMessages, messagesWithParticipants });
      expect(text).toContain(FINAL_CONTENT);
      expectNoRecord(text);
    });
  });

  it('extractVisibleConversation (every cheap-LLM pass) hands on the final content only', () => {
    const visible = extractVisibleConversation(messages as never);
    const text = JSON.stringify(visible);
    expect(text).toContain(FINAL_CONTENT);
    expectNoRecord(text);
  });

  it("read_conversation's renderer shows the final content only", () => {
    const rendered = renderConversationMarkdown(
      messages as never,
      [] as never,
      new Map(),
      { conversationId: 'chat-1', title: 'T', createdAt: '2026-05-01T00:00:00.000Z', lastUpdatedAt: '2026-05-02T00:00:00.000Z' } as never
    );
    const text = JSON.stringify(rendered);
    expect(rendered.markdown).toContain(FINAL_CONTENT);
    expectNoRecord(text);
  });

  it("the Courier's delta carries the final content only", async () => {
    mockRenderCourierDeltaAsMarkdown.mockReset();
    mockRenderCourierDeltaAsMarkdown.mockReturnValue({ markdown: '## Delta', attachments: [] });
    const checkpoint = { lastResolvedMessageId: 'x', resolvedAt: '2026-05-01T00:00:00.000Z' };
    const chat = {
      id: 'chat-1',
      participants: [
        { id: 'p-char', characterId: 'char-1' },
        { id: 'p-user', characterId: null },
      ],
      courierCheckpoints: { 'char-1': checkpoint },
    };
    const repos = {
      chats: {
        addMessage: jest.fn(async () => undefined),
        update: jest.fn(async () => undefined),
        getMessages: jest.fn(async () => [adjustedPascalMessage()]),
      },
      files: { findById: jest.fn(async () => null) },
    };

    await dispatchCourierTransport({
      repos: repos as never,
      chatId: 'chat-1',
      chat: chat as never,
      character: { id: 'char-1', name: 'Alice' } as never,
      characterParticipant: { id: 'p-char' } as never,
      userParticipantId: 'p-user',
      isMultiCharacter: false,
      participantCharacters: new Map(),
      resolvedIdentity: { name: 'Captain', description: '', characterId: null } as never,
      formattedMessages: [],
      streaming: {
        fullResponse: '',
        effectiveProfile: { provider: 'CUSTOM', modelName: 'm', transport: 'courier', courierDeltaMode: true },
        effectiveApiKey: '',
        usage: null,
        cacheUsage: null,
        attachmentResults: null,
        rawResponse: null,
        thoughtSignature: undefined,
        hasStartedStreaming: false,
        routeFailures: [],
        routeVia: 'primary',
      } as never,
      controller: { enqueue: jest.fn() } as never,
      encoder: new TextEncoder(),
    });

    expect(mockRenderCourierDeltaAsMarkdown).toHaveBeenCalledTimes(1);
    const { events } = mockRenderCourierDeltaAsMarkdown.mock.calls[0][0] as { events: unknown[] };
    const text = JSON.stringify(events);
    expect(events).toHaveLength(1);
    expect(text).toContain(FINAL_CONTENT);
    expectNoRecord(text);
  });
});
