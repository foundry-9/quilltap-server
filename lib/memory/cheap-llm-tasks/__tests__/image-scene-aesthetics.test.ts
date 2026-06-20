/**
 * Unit tests for default-aesthetic + Ariel-Clause injection into the two
 * image-prompt crafting calls. We mock executeCheapLLMTask to capture the
 * messages handed to the cheap LLM and assert the labelled blocks appear only
 * when the new context fields are set.
 */

// ── Subject ───────────────────────────────────────────────────────────────────
import { craftStoryBackgroundPrompt, craftImagePrompt } from '../image-scene-tasks';

// ── Mocks ─────────────────────────────────────────────────────────────────────
jest.mock('../core-execution', () => ({
  executeCheapLLMTask: jest.fn(),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────
import { executeCheapLLMTask } from '../core-execution';
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm';

const SELECTION: CheapLLMSelection = {
  provider: 'OPENAI',
  modelName: 'gpt-test',
  connectionProfileId: 'profile-1',
  isLocal: false,
} as never;

function lastUserMessage(): string {
  const calls = jest.mocked(executeCheapLLMTask).mock.calls;
  const messages = calls[calls.length - 1][1] as Array<{ role: string; content: string }>;
  return messages.find((m) => m.role === 'user')!.content;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(executeCheapLLMTask).mockImplementation(
    async (_sel, _msgs, _uid, parse) => ({ success: true, result: (parse as (c: string) => unknown)('out') }) as never,
  );
});

describe('craftStoryBackgroundPrompt aesthetic injection', () => {
  const base = {
    sceneContext: 'a moonlit pier',
    characters: [{ name: 'Ariel', description: 'a young woman' }],
    provider: 'OPENAI',
  };

  it('omits aesthetic blocks when no fields are set', async () => {
    await craftStoryBackgroundPrompt(base, SELECTION, 'user-1', 'chat-1');
    const user = lastUserMessage();
    expect(user).not.toContain('Overall image aesthetic');
    expect(user).not.toContain('Character depiction aesthetic');
    expect(user).not.toContain('MANDATORY');
  });

  it('injects scene + character aesthetics and the mandatory depiction block', async () => {
    await craftStoryBackgroundPrompt(
      {
        ...base,
        sceneAesthetic: '1920s art-deco illustration',
        characterAesthetic: 'flapper-era fashion',
        depictionGuidelines: [{ characterName: 'Ariel', content: 'never show her tail' }],
      },
      SELECTION,
      'user-1',
      'chat-1',
    );
    const user = lastUserMessage();
    expect(user).toContain('Overall image aesthetic');
    expect(user).toContain('1920s art-deco illustration');
    expect(user).toContain('Character depiction aesthetic');
    expect(user).toContain('flapper-era fashion');
    expect(user).toContain('MANDATORY');
    expect(user).toContain('Ariel: never show her tail');
  });
});

describe('craftImagePrompt aesthetic injection', () => {
  const base = {
    originalPrompt: 'a scene with {{0}}',
    placeholders: [{ placeholder: '{{0}}', name: 'Ariel', tiers: { short: 'a woman' } }],
    targetLength: 1000,
    provider: 'OPENAI',
  };

  it('omits aesthetic blocks when no fields are set', async () => {
    await craftImagePrompt(base, SELECTION, 'user-1', 'chat-1');
    const user = lastUserMessage();
    expect(user).not.toContain('Overall image aesthetic');
    expect(user).not.toContain('MANDATORY');
  });

  it('injects aesthetics and the mandatory depiction block, attributed by name', async () => {
    await craftImagePrompt(
      {
        ...base,
        sceneAesthetic: 'swords-and-sorcery oil painting',
        characterAesthetic: 'weathered adventurers',
        depictionGuidelines: [
          { characterName: 'Ariel', content: 'always cloaked' },
          { characterName: 'Triton', content: 'crowned' },
        ],
      },
      SELECTION,
      'user-1',
      'chat-1',
    );
    const user = lastUserMessage();
    expect(user).toContain('swords-and-sorcery oil painting');
    expect(user).toContain('weathered adventurers');
    expect(user).toContain('MANDATORY');
    expect(user).toContain('Ariel: always cloaked');
    expect(user).toContain('Triton: crowned');
  });

  it('omits the depiction block for an empty guidelines array', async () => {
    await craftImagePrompt(
      { ...base, sceneAesthetic: 'noir', depictionGuidelines: [] },
      SELECTION,
      'user-1',
      'chat-1',
    );
    const user = lastUserMessage();
    expect(user).toContain('noir');
    expect(user).not.toContain('MANDATORY');
  });
});
