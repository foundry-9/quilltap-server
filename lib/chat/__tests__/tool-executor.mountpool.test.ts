/**
 * Scenario Builder mount pool (docs/developer/features/scenario-builder.md
 * §5.2): `mountPool` and `operatorSurface` are mutually exclusive on
 * `ToolExecutionContext` — the executor refuses a context that sets both,
 * before doing any real tool-call work.
 *
 * No mocking of the module's (many) transitive imports is needed: the guard
 * runs at the very top of `executeToolCallWithContext`, before any registry
 * lookup, so this is just as lightweight as the existing
 * `__tests__/unit/tool-executor.test.ts`, which also imports the module
 * directly with no mocks.
 */

import { describe, it, expect } from '@jest/globals';
import {
  executeToolCallWithContext,
  type ToolCallRequest,
  type ToolExecutionContext,
} from '@/lib/chat/tool-executor';
import type { TieredMountPool } from '@/lib/mount-index/tiered-mount-pool';

const emptyPool: TieredMountPool = {
  characterMountPointId: null,
  participantMountPointIds: [],
  groupMountPointIds: [],
  projectMountPointIds: [],
  globalMountPointId: null,
};

const toolCall: ToolCallRequest = {
  name: 'doc_list_files',
  arguments: {},
};

describe('executeToolCallWithContext: mountPool / operatorSurface mutual exclusivity', () => {
  it('refuses a context that sets both mountPool and operatorSurface', async () => {
    const context: ToolExecutionContext = {
      chatId: 'chat-1',
      userId: 'u1',
      mountPool: emptyPool,
      operatorSurface: true,
    };

    const result = await executeToolCallWithContext(toolCall, context);

    expect(result).toMatchObject({
      toolName: toolCall.name,
      success: false,
      result: null,
      error: 'Tool context is misconfigured (mountPool and operatorSurface are mutually exclusive).',
    });
  });
});
