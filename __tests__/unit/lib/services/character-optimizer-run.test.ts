/**
 * runCharacterOptimizer — the grounds a refinement works from.
 *
 * Covers the memories / instructions / both choice: an instructions-only run
 * never touches the Commonplace Book, a thin dossier with instructions carries
 * on rather than stopping, and every LLM call carries the instructions.
 */

import { runCharacterOptimizer } from '@/lib/services/character-optimizer.service';
import type { OptimizerProgressEvent } from '@/lib/services/character-optimizer.service';
import { createLLMProvider } from '@/lib/llm';
import { isPluginSystemInitialized } from '@/lib/startup';
import { providerRegistry } from '@/lib/plugins/provider-registry';
import { logLLMCall } from '@/lib/services/llm-logging.service';
import { createMockCharacter, createMockMemory } from '../fixtures/test-factories';
import type { RepositoryContainer } from '@/lib/repositories/factory';

jest.mock('@/lib/llm', () => ({ createLLMProvider: jest.fn() }));
jest.mock('@/lib/services/llm-logging.service', () => ({ logLLMCall: jest.fn(() => Promise.resolve(null)) }));
jest.mock('@/lib/startup', () => ({ initializePlugins: jest.fn(), isPluginSystemInitialized: jest.fn() }));
jest.mock('@/lib/plugins/provider-registry', () => ({ providerRegistry: { isInitialized: jest.fn() } }));
jest.mock('@/lib/embedding/embedding-service', () => ({
  generateEmbeddingForUser: jest.fn(),
  isEmbeddingAvailable: jest.fn().mockResolvedValue(false),
}));
jest.mock('@/lib/memory/index-store', () => ({ memoryIndex: { search: jest.fn() } }));
jest.mock('@/lib/mount-index/database-store', () => ({ writeDatabaseDocument: jest.fn() }));
jest.mock('@/lib/logger', () => {
  const makeLogger = (): Record<string, unknown> => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

const USER_ID = 'user-1';
const CHARACTER_ID = 'char-1';
const PROFILE_ID = 'profile-1';

const ANALYSIS_JSON = JSON.stringify({
  behavioralPatterns: [{ pattern: 'Runs a bookshop', evidence: 'instruction', frequency: "Author's instruction" }],
  summary: 'The author moves her to Bath.',
});

function makeRepos(memories = [] as ReturnType<typeof createMockMemory>[]) {
  const character = createMockCharacter({ id: CHARACTER_ID, userId: USER_ID, scenarios: [], systemPrompts: [] });
  return {
    characters: { findById: jest.fn().mockResolvedValue(character) },
    memories: {
      findByCharacterAboutCharacter: jest.fn().mockResolvedValue(memories),
      searchByContentAboutCharacter: jest.fn().mockResolvedValue(memories),
    },
    connections: {
      findById: jest.fn().mockResolvedValue({ id: PROFILE_ID, userId: USER_ID, provider: 'TEST', modelName: 'm' }),
      findApiKeyByIdAndUserId: jest.fn(),
    },
    wardrobe: { findByCharacterId: jest.fn().mockResolvedValue([]) },
  } as unknown as RepositoryContainer;
}

function reinforced(n: number) {
  return Array.from({ length: n }, (_, i) =>
    createMockMemory({ id: `m-${i}`, characterId: CHARACTER_ID, content: `Memory ${i}`, reinforcementCount: 3 }),
  );
}

describe('runCharacterOptimizer — memories and instructions', () => {
  let sendMessage: jest.Mock;

  beforeEach(() => {
    jest.mocked(logLLMCall).mockClear();
    sendMessage = jest.fn(async (req: { messages: Array<{ content: string }> }) => {
      const instruction = req.messages[2].content;
      return {
        content: instruction.includes('"behavioralPatterns"') ? ANALYSIS_JSON : '[]',
        usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
        cacheUsage: { cacheCreationInputTokens: 0, cacheReadInputTokens: 5000 },
        raw: { usage: { input_tokens: 100, cache_read_input_tokens: 5000, output_tokens: 20 } },
      };
    });
    jest.mocked(createLLMProvider).mockResolvedValue({ sendMessage } as never);
    jest.mocked(isPluginSystemInitialized).mockReturnValue(true);
    jest.mocked(providerRegistry.isInitialized).mockReturnValue(true);
  });

  async function run(repos: RepositoryContainer, options: Parameters<typeof runCharacterOptimizer>[5]) {
    const events: OptimizerProgressEvent[] = [];
    await runCharacterOptimizer(CHARACTER_ID, PROFILE_ID, USER_ID, repos, (e) => events.push(e), options);
    return events;
  }

  it('refuses a run with neither memories nor instructions', async () => {
    const events = await run(makeRepos(), { useMemories: false, instructions: '   ' });
    expect(events.at(-1)?.type).toBe('error');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('an instructions-only run never reads the Commonplace Book and carries the instructions to every call', async () => {
    const repos = makeRepos(reinforced(5));
    const events = await run(repos, { useMemories: false, instructions: 'She now runs a bookshop in Bath.' });

    expect(repos.memories.findByCharacterAboutCharacter).not.toHaveBeenCalled();
    expect(events.find((e) => e.type === 'step_complete' && e.step === 'loading')?.memoryCount).toBe(0);
    expect(events.at(-1)?.type).toBe('done');
    expect(sendMessage.mock.calls.length).toBeGreaterThan(1);
    for (const [req] of sendMessage.mock.calls) {
      const user = req.messages[1].content as string;
      expect(user).toContain('She now runs a bookshop in Bath.');
      expect(user).toContain('No memories were consulted for this refinement.');
    }
    // The analysis is the instructions-only reading.
    expect(sendMessage.mock.calls[0][0].messages[2].content).toContain("against the author's instructions");
  });

  it('a memories-only run with too few reinforced memories still stops early', async () => {
    const events = await run(makeRepos(reinforced(1)), { useMemories: true });
    expect(events.at(-1)?.type).toBe('done');
    expect(events.at(-1)?.analysis?.summary).toBe('Not enough reinforced memories to analyze.');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('a thin dossier with instructions carries on, on the instructions alone', async () => {
    const events = await run(makeRepos(reinforced(1)), { useMemories: true, instructions: 'Soften her temper.' });
    expect(events.find((e) => e.type === 'step_complete' && e.step === 'loading')?.memoryCount).toBe(0);
    expect(sendMessage).toHaveBeenCalled();
    const firstUser = sendMessage.mock.calls[0][0].messages[1].content as string;
    expect(firstUser).toContain('Soften her temper.');
    expect(firstUser).not.toContain('Memory 0');
    expect(events.at(-1)?.type).toBe('done');
  });

  it('sends the shared context as one unchanging message ahead of each pass instruction', async () => {
    await run(makeRepos(reinforced(4)), { useMemories: true, instructions: 'Soften her temper.' });
    const calls = sendMessage.mock.calls.map(([req]) => req.messages as Array<{ role: string; content: string }>);
    expect(calls.length).toBeGreaterThan(2);
    const shared = calls[0][1].content;
    for (const messages of calls) {
      expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'user']);
      // Byte-identical across the run, so a prompt cache can hold it.
      expect(messages[1].content).toBe(shared);
      expect(messages[2].content).not.toContain('Memory 0');
    }
    expect(new Set(calls.map((m) => m[2].content)).size).toBe(calls.length);
  });

  it('logs each call with the provider usage and cache figures', async () => {
    await run(makeRepos(reinforced(4)), { useMemories: true });
    const logged = jest.mocked(logLLMCall).mock.calls.map(([params]) => params);
    expect(logged.length).toBe(sendMessage.mock.calls.length);
    for (const params of logged) {
      expect(params.type).toBe('CHARACTER_OPTIMIZER');
      expect(params.usage).toEqual({ promptTokens: 100, completionTokens: 20, totalTokens: 120 });
      expect(params.cacheUsage).toEqual({ cacheCreationInputTokens: 0, cacheReadInputTokens: 5000 });
      expect(params.rawProviderUsage).toEqual({ input_tokens: 100, cache_read_input_tokens: 5000, output_tokens: 20 });
    }
  });

  it('memories and instructions together put both in front of the model', async () => {
    const events = await run(makeRepos(reinforced(4)), { useMemories: true, instructions: 'Soften her temper.' });
    const firstUser = sendMessage.mock.calls[0][0].messages[1].content as string;
    expect(firstUser).toContain('Memory 0');
    expect(firstUser).toContain('Soften her temper.');
    expect(firstUser).toContain('the instructions win');
    expect(events.find((e) => e.type === 'step_complete' && e.step === 'loading')?.memoryCount).toBe(4);
  });
});
