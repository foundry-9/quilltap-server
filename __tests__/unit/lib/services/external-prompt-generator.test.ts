/**
 * Tests for external-prompt-generator.service
 */

import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { ExternalPromptRequest } from '@/lib/services/external-prompt-generator.service';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

jest.mock('@/lib/startup', () => ({
  initializePlugins: jest.fn().mockResolvedValue(undefined),
  isPluginSystemInitialized: jest.fn().mockReturnValue(true),
}));

const mockSendMessage = jest.fn();

jest.mock('@/lib/llm', () => ({
  createLLMProvider: jest.fn().mockResolvedValue({
    sendMessage: (...args: unknown[]) => mockSendMessage(...args),
  }),
}));

jest.mock('@/lib/llm/model-context-data', () => ({
  getSafeInputLimit: jest.fn().mockReturnValue(100_000),
}));

jest.mock('@/lib/services/llm-logging.service', () => ({
  logLLMCall: jest.fn().mockResolvedValue(undefined),
}));

import { generateExternalPrompt } from '@/lib/services/external-prompt-generator.service';
import { createLLMProvider } from '@/lib/llm';
import { logLLMCall } from '@/lib/services/llm-logging.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepos(overrides: Record<string, any> = {}): RepositoryContainer {
  return {
    connections: {
      findById: jest.fn().mockResolvedValue({
        id: 'conn-1',
        provider: 'openai',
        modelName: 'gpt-4',
        baseUrl: null,
        apiKeyId: 'key-1',
      }),
      findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({
        id: 'key-1',
        key_value: 'sk-test-key',
      }),
      ...overrides.connections,
    },
    characters: {
      findById: jest.fn().mockResolvedValue({
        id: 'char-1',
        name: 'Aria',
        title: 'The Brave',
        aliases: ['Shadow'],
        pronouns: { subject: 'she', object: 'her', possessive: 'her' },
        description: 'A brave adventurer.',
        personality: 'Bold and curious.',
        firstMessage: 'Hello, traveler.',
        exampleDialogues: 'User: Hi\nAria: Well met!',
        systemPrompts: [
          { id: 'sp-1', name: 'Default', content: 'You are Aria, a bold adventurer.' },
        ],
        scenarios: [
          { id: 'sc-1', title: 'Tavern', content: 'A cozy tavern by the fire.' },
        ],
      }),
      getDescriptions: jest.fn().mockResolvedValue([
        {
          id: 'desc-1',
          name: 'Standard',
          fullDescription: 'Tall with silver hair and green eyes.',
          completePrompt: null,
          longPrompt: null,
          mediumPrompt: null,
          shortPrompt: null,
        },
      ]),
      getClothingRecords: jest.fn().mockResolvedValue([
        { id: 'cloth-1', name: 'Adventure Gear', description: 'Leather armor with a dark cloak.' },
      ]),
      ...overrides.characters,
    },
  } as unknown as RepositoryContainer;
}

function makeRequest(overrides: Partial<ExternalPromptRequest> = {}): ExternalPromptRequest {
  return {
    connectionProfileId: 'conn-1',
    systemPromptId: 'sp-1',
    scenarioId: 'sc-1',
    descriptionId: 'desc-1',
    clothingRecordId: 'cloth-1',
    maxTokens: 4000,
    ...overrides,
  };
}

const DEFAULT_LLM_RESPONSE = {
  content: '# Aria\n\nYou are Aria, a bold adventurer...',
  usage: { promptTokens: 500, completionTokens: 1000, totalTokens: 1500 },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateExternalPrompt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendMessage.mockResolvedValue(DEFAULT_LLM_RESPONSE);
  });

  // 1. Successful generation with all optional fields
  it('generates a prompt successfully with all optional fields', async () => {
    const repos = makeRepos();
    const request = makeRequest();

    const result = await generateExternalPrompt('char-1', request, 'user-1', repos);

    expect(result.success).toBe(true);
    expect(result.prompt).toBe(DEFAULT_LLM_RESPONSE.content);
    expect(result.tokensUsed).toBe(1500);
    expect(result.error).toBeUndefined();
  });

  it('resolves scenario, description, and clothing when IDs are provided', async () => {
    const repos = makeRepos();
    const request = makeRequest();

    await generateExternalPrompt('char-1', request, 'user-1', repos);

    expect(repos.characters.getDescriptions).toHaveBeenCalledWith('char-1');
    expect((repos.characters as any).getClothingRecords).toHaveBeenCalledWith('char-1');

    // The user message sent to LLM should include scenario, appearance, and clothing sections
    const sentMessages = mockSendMessage.mock.calls[0][0].messages;
    const userMessage: string = sentMessages[1].content;
    expect(userMessage).toContain('Scenario / Setting');
    expect(userMessage).toContain('A cozy tavern by the fire.');
    expect(userMessage).toContain('Physical Appearance');
    expect(userMessage).toContain('Tall with silver hair and green eyes.');
    expect(userMessage).toContain('Clothing / Attire');
    expect(userMessage).toContain('Leather armor with a dark cloak.');
  });

  // 2. Generation without optional fields
  it('generates a prompt without optional fields', async () => {
    const repos = makeRepos();
    const request = makeRequest({
      scenarioId: undefined,
      descriptionId: undefined,
      clothingRecordId: undefined,
    });

    const result = await generateExternalPrompt('char-1', request, 'user-1', repos);

    expect(result.success).toBe(true);
    expect(result.prompt).toBe(DEFAULT_LLM_RESPONSE.content);

    // Should not have called getDescriptions or getClothingRecords
    expect(repos.characters.getDescriptions).not.toHaveBeenCalled();
    expect((repos.characters as any).getClothingRecords).not.toHaveBeenCalled();

    // User message should not contain optional sections
    const userMessage: string = mockSendMessage.mock.calls[0][0].messages[1].content;
    expect(userMessage).not.toContain('Scenario / Setting');
    expect(userMessage).not.toContain('Physical Appearance');
    expect(userMessage).not.toContain('Clothing / Attire');
  });

  // 3. Connection profile not found
  it('returns error when connection profile not found', async () => {
    const repos = makeRepos({
      connections: { findById: jest.fn().mockResolvedValue(null) },
    });
    const request = makeRequest();

    const result = await generateExternalPrompt('char-1', request, 'user-1', repos);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Connection profile not found');
    expect(result.prompt).toBe('');
    expect(result.tokensUsed).toBe(0);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  // 4. Character not found
  it('returns error when character not found', async () => {
    const repos = makeRepos({
      characters: {
        findById: jest.fn().mockResolvedValue(null),
        getDescriptions: jest.fn(),
        getClothingRecords: jest.fn(),
      },
    });
    const request = makeRequest();

    const result = await generateExternalPrompt('char-1', request, 'user-1', repos);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Character not found');
    expect(result.prompt).toBe('');
    expect(result.tokensUsed).toBe(0);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  // 5. API key not found (proceeds with empty key)
  it('uses empty API key when key record not found', async () => {
    const repos = makeRepos({
      connections: {
        findById: jest.fn().mockResolvedValue({
          id: 'conn-1',
          provider: 'openai',
          modelName: 'gpt-4',
          baseUrl: null,
          apiKeyId: 'key-missing',
        }),
        findApiKeyByIdAndUserId: jest.fn().mockResolvedValue(null),
      },
    });
    const request = makeRequest();

    await generateExternalPrompt('char-1', request, 'user-1', repos);

    // Provider sendMessage should have been called with empty string as API key
    expect(mockSendMessage).toHaveBeenCalled();
    const apiKeyArg = mockSendMessage.mock.calls[0][1];
    expect(apiKeyArg).toBe('');
  });

  // 6. LLM provider is called with correct assembled prompt
  it('calls LLM provider with correct parameters', async () => {
    const repos = makeRepos();
    const request = makeRequest({ maxTokens: 8000 });

    await generateExternalPrompt('char-1', request, 'user-1', repos);

    expect(createLLMProvider).toHaveBeenCalledWith('openai', undefined);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);

    const callArgs = mockSendMessage.mock.calls[0][0];
    expect(callArgs.model).toBe('gpt-4');
    expect(callArgs.maxTokens).toBe(8000);
    expect(callArgs.temperature).toBe(0.7);
    expect(callArgs.messages).toHaveLength(2);
    expect(callArgs.messages[0].role).toBe('system');
    expect(callArgs.messages[1].role).toBe('user');

    // System message should contain meta prompt content
    expect(callArgs.messages[0].content).toContain('prompt engineering expert');

    // User message should contain character info
    const userContent: string = callArgs.messages[1].content;
    expect(userContent).toContain('Character: Aria');
    expect(userContent).toContain('The Brave');
    expect(userContent).toContain('Shadow');
    expect(userContent).toContain('she/her/her');
    expect(userContent).toContain('A brave adventurer.');
    expect(userContent).toContain('Bold and curious.');
    expect(userContent).toContain('System Prompt');
    expect(userContent).toContain('You are Aria, a bold adventurer.');
    expect(userContent).toContain('Hello, traveler.');
    expect(userContent).toContain('Example Dialogues');
  });

  // 7. Token usage is tracked in result
  it('tracks token usage in result', async () => {
    mockSendMessage.mockResolvedValue({
      content: 'Generated prompt text',
      usage: { promptTokens: 200, completionTokens: 3000, totalTokens: 3200 },
    });

    const repos = makeRepos();
    const request = makeRequest();

    const result = await generateExternalPrompt('char-1', request, 'user-1', repos);

    expect(result.tokensUsed).toBe(3200);
  });

  it('reports zero tokens when usage is not available', async () => {
    mockSendMessage.mockResolvedValue({
      content: 'Generated prompt text',
      usage: undefined,
    });

    const repos = makeRepos();
    const request = makeRequest();

    const result = await generateExternalPrompt('char-1', request, 'user-1', repos);

    expect(result.success).toBe(true);
    expect(result.tokensUsed).toBe(0);
  });

  // 8. LLM errors are caught and returned as error result
  it('catches LLM errors and returns error result', async () => {
    mockSendMessage.mockRejectedValue(new Error('Rate limit exceeded'));

    const repos = makeRepos();
    const request = makeRequest();

    const result = await generateExternalPrompt('char-1', request, 'user-1', repos);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Rate limit exceeded');
    expect(result.prompt).toBe('');
    expect(result.tokensUsed).toBe(0);
  });

  it('returns generic error message for non-Error throws', async () => {
    mockSendMessage.mockRejectedValue('something unexpected');

    const repos = makeRepos();
    const request = makeRequest();

    const result = await generateExternalPrompt('char-1', request, 'user-1', repos);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Generation failed');
  });

  // Additional edge cases

  it('returns error when system prompt ID not found on character', async () => {
    const repos = makeRepos();
    const request = makeRequest({ systemPromptId: 'nonexistent-sp' });

    const result = await generateExternalPrompt('char-1', request, 'user-1', repos);

    expect(result.success).toBe(false);
    expect(result.error).toBe('System prompt not found');
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('returns error when no content in LLM response', async () => {
    mockSendMessage.mockResolvedValue({ content: null, usage: null });

    const repos = makeRepos();
    const request = makeRequest();

    const result = await generateExternalPrompt('char-1', request, 'user-1', repos);

    expect(result.success).toBe(false);
    expect(result.error).toBe('No response from model');
  });

  it('logs the LLM call after successful generation', async () => {
    const repos = makeRepos();
    const request = makeRequest();

    await generateExternalPrompt('char-1', request, 'user-1', repos);

    expect(logLLMCall).toHaveBeenCalledTimes(1);
    expect(logLLMCall).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        type: 'EXTERNAL_PROMPT',
        characterId: 'char-1',
        provider: 'openai',
        modelName: 'gpt-4',
      })
    );
  });

  it('passes baseUrl to createLLMProvider when present', async () => {
    const repos = makeRepos({
      connections: {
        findById: jest.fn().mockResolvedValue({
          id: 'conn-1',
          provider: 'openai',
          modelName: 'gpt-4',
          baseUrl: 'https://custom.api.example.com',
          apiKeyId: 'key-1',
        }),
        findApiKeyByIdAndUserId: jest.fn().mockResolvedValue({
          id: 'key-1',
          key_value: 'sk-test-key',
        }),
      },
    });
    const request = makeRequest();

    await generateExternalPrompt('char-1', request, 'user-1', repos);

    expect(createLLMProvider).toHaveBeenCalledWith('openai', 'https://custom.api.example.com');
  });
});
