/**
 * The effect ceiling (storyteller-mode Part 1.6): a call above the turn's
 * ceiling is refused at the top of `executeToolCallWithContext`, with a tool
 * result saying why, before any registry lookup — so, like the mountPool
 * guard's test beside it, no transitive mocking is needed.
 */

import { describe, it, expect } from '@jest/globals';
import { executeToolCallWithContext, type ToolExecutionContext } from '@/lib/chat/tool-executor';

const base: ToolExecutionContext = { chatId: 'chat-1', userId: 'u1' };

describe('executeToolCallWithContext: effect ceiling', () => {
  it('refuses a write under a read ceiling, naming both', async () => {
    const result = await executeToolCallWithContext(
      { name: 'doc_write_file', arguments: { path: 'a.md', content: 'x' } },
      { ...base, effectCeiling: 'read' }
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/`doc_write_file` is a write call, and this turn allows only lookups/);
    expect(result.result).toMatchObject({ formattedText: result.error });
  });

  it('refuses a deletion under a write ceiling (the autonomous-room gate)', async () => {
    const result = await executeToolCallWithContext(
      { name: 'doc_delete_file', arguments: { path: 'a.md' } },
      { ...base, effectCeiling: 'write' }
    );
    expect(result.error).toMatch(/is a destroy call/);
  });

  it('judges a computed effect by its input', async () => {
    const refused = await executeToolCallWithContext(
      { name: 'state', arguments: { operation: 'set', path: 'a', value: 1 } },
      { ...base, effectCeiling: 'read' }
    );
    expect(refused.error).toMatch(/`state` is a write call/);
  });

  it('ranks run_custom by the named custom tool', async () => {
    const refused = await executeToolCallWithContext(
      { name: 'run_custom', arguments: { tool: 'unlock' } },
      { ...base, effectCeiling: 'read', customToolEffects: new Map([['unlock', 'write'], ['peek', 'read']]) }
    );
    expect(refused.error).toMatch(/`run_custom` is a write call/);
  });

  it('counts an undeclared plugin tool as a write', async () => {
    const refused = await executeToolCallWithContext(
      { name: 'some_mcp_tool', arguments: {} },
      { ...base, effectCeiling: 'read' }
    );
    expect(refused.error).toMatch(/`some_mcp_tool` is a write call/);
  });
});
