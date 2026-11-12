import { extractFinishReason, isTruncatedFinishReason } from '../extract-finish-reason';

describe('extractFinishReason', () => {
  it('reads OpenAI Chat Completions / Z.AI / OpenRouter shape', () => {
    expect(extractFinishReason({ choices: [{ finish_reason: 'stop' }] })).toBe('stop');
    expect(extractFinishReason({ choices: [{ finish_reason: 'tool_calls' }] })).toBe('tool_calls');
    expect(extractFinishReason({ choices: [{ finish_reason: 'length' }] })).toBe('length');
    expect(extractFinishReason({ choices: [{ finish_reason: 'content_filter' }] })).toBe('content_filter');
  });

  it('reads Anthropic stop_reason', () => {
    expect(extractFinishReason({ stop_reason: 'end_turn' })).toBe('end_turn');
    expect(extractFinishReason({ stop_reason: 'max_tokens' })).toBe('max_tokens');
    expect(extractFinishReason({ stop_reason: 'tool_use' })).toBe('tool_use');
  });

  it('reads Google candidates[0].finishReason', () => {
    expect(extractFinishReason({ candidates: [{ finishReason: 'STOP' }] })).toBe('STOP');
    expect(extractFinishReason({ candidates: [{ finishReason: 'MAX_TOKENS' }] })).toBe('MAX_TOKENS');
    expect(extractFinishReason({ candidates: [{ finishReason: 'SAFETY' }] })).toBe('SAFETY');
  });

  it('reads OpenAI Responses / Grok status', () => {
    expect(extractFinishReason({ status: 'completed' })).toBe('completed');
    expect(extractFinishReason({ status: 'incomplete' })).toBe('incomplete');
  });

  it('prefers choices over stop_reason if both present', () => {
    expect(extractFinishReason({ choices: [{ finish_reason: 'stop' }], stop_reason: 'end_turn' })).toBe('stop');
  });

  it('returns null for unrecognized shapes', () => {
    expect(extractFinishReason(null)).toBeNull();
    expect(extractFinishReason(undefined)).toBeNull();
    expect(extractFinishReason({})).toBeNull();
    expect(extractFinishReason({ choices: [] })).toBeNull();
    expect(extractFinishReason({ choices: [{}] })).toBeNull();
    expect(extractFinishReason({ candidates: [] })).toBeNull();
    expect(extractFinishReason('stop')).toBeNull();
  });
});

describe('isTruncatedFinishReason', () => {
  it('matches every provider spelling of "hit the token ceiling"', () => {
    expect(isTruncatedFinishReason('max_tokens')).toBe(true);
    expect(isTruncatedFinishReason('MAX_TOKENS')).toBe(true);
    expect(isTruncatedFinishReason('length')).toBe(true);
    expect(isTruncatedFinishReason('model_length')).toBe(true);
  });

  it('does not match a natural stop or a missing reason', () => {
    expect(isTruncatedFinishReason('end_turn')).toBe(false);
    expect(isTruncatedFinishReason('stop')).toBe(false);
    expect(isTruncatedFinishReason(null)).toBe(false);
    expect(isTruncatedFinishReason(undefined)).toBe(false);
  });
});
