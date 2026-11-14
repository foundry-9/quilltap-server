/**
 * `selectGreenRoomLLM`: the Green Room's designated profile wins when it
 * exists; otherwise (unset or stale) the cheap-LLM ladder answers.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('@/lib/logger', () => {
  const makeLogger = (): any => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(() => makeLogger()),
  });
  return { logger: makeLogger() };
});

jest.mock('@/lib/llm/cheap-llm-user-selection', () => ({
  selectCheapLLMFromProfiles: jest.fn(),
}));

const { selectGreenRoomLLM } = require('@/lib/chat/opening/green-room/model');
const { selectCheapLLMFromProfiles } = require('@/lib/llm/cheap-llm-user-selection');
const { buildCheapLLMConfig } = require('@/lib/llm/cheap-llm');

const mockCheap = selectCheapLLMFromProfiles as jest.Mock;

function profile(id: string, provider = 'ANTHROPIC', modelName = 'claude-sonnet-5-5') {
  return { id, provider, modelName, baseUrl: null, parameters: {}, isDefault: false };
}

const CHEAP_SELECTION = { provider: 'Z_AI', modelName: 'glm-5.3-flash', connectionProfileId: 'cheap', isLocal: false };

describe('selectGreenRoomLLM', () => {
  beforeEach(() => {
    mockCheap.mockReset();
    mockCheap.mockReturnValue({ selection: CHEAP_SELECTION });
  });

  it('uses the designated profile when it exists', () => {
    const result = selectGreenRoomLLM(
      [profile('cheap', 'Z_AI', 'glm-5.3-flash'), profile('smart')],
      { strategy: 'PROVIDER_CHEAPEST', fallbackToLocal: true, outfitSelectionProfileId: 'smart' },
    );
    expect(result.source).toBe('designated');
    expect(result.selection).toMatchObject({ provider: 'ANTHROPIC', modelName: 'claude-sonnet-5-5', connectionProfileId: 'smart' });
    expect(mockCheap).not.toHaveBeenCalled();
  });

  it('falls back to the cheap LLM when unset', () => {
    const result = selectGreenRoomLLM([profile('cheap')], { strategy: 'PROVIDER_CHEAPEST', fallbackToLocal: true });
    expect(result).toEqual({ selection: CHEAP_SELECTION, source: 'cheap' });
  });

  it('falls back to the cheap LLM when the designated profile is gone', () => {
    const result = selectGreenRoomLLM(
      [profile('cheap')],
      { strategy: 'PROVIDER_CHEAPEST', fallbackToLocal: true, outfitSelectionProfileId: 'deleted' },
    );
    expect(result.source).toBe('cheap');
  });

  it('returns null when there are no profiles at all', () => {
    mockCheap.mockReturnValue(null);
    expect(selectGreenRoomLLM([], { strategy: 'PROVIDER_CHEAPEST', fallbackToLocal: true })).toBeNull();
  });

  it('is carried from chat settings by buildCheapLLMConfig', () => {
    const config = buildCheapLLMConfig({
      cheapLLMSettings: {
        strategy: 'PROVIDER_CHEAPEST', fallbackToLocal: true, allowCheapFallback: false,
        embeddingProvider: 'OPENAI', outfitSelectionProfileId: 'smart',
      },
    });
    expect(config.outfitSelectionProfileId).toBe('smart');
  });
});
