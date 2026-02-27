/**
 * Unit tests for the run-tool action handler
 *
 * Tests cover:
 * - Input validation (missing tool name, invalid body)
 * - Blacklisted/forbidden tools
 * - Successful tool execution path
 * - Chat not found
 * - Error handling
 *
 * POST /api/v1/chats/[id]?action=run-tool
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { NextRequest } from 'next/server';

// Mock logger
jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock tool executor
const mockExecuteToolCallWithContext = jest.fn();
jest.mock('@/lib/chat/tool-executor', () => ({
  executeToolCallWithContext: (...args: unknown[]) => mockExecuteToolCallWithContext(...args),
}));

import { handleRunTool } from '@/app/api/v1/chats/[id]/actions/run-tool';
import type { AuthenticatedContext } from '@/lib/api/middleware';

// Helper to create a mock NextRequest with JSON body
function createRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/v1/chats/chat-123?action=run-tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Helper to create a mock AuthenticatedContext
function createMockContext(overrides: {
  chatData?: Record<string, unknown> | null;
} = {}): AuthenticatedContext {
  const mockChat = overrides.chatData !== undefined ? overrides.chatData : {
    id: 'chat-123',
    title: 'Test Chat',
    projectId: null,
    participants: [
      {
        id: 'participant-1',
        type: 'CHARACTER',
        isActive: true,
        characterId: 'char-1',
        imageProfileId: 'img-profile-1',
      },
    ],
  };

  return {
    user: { id: 'user-1', name: 'Test User' },
    repos: {
      chats: {
        findById: jest.fn().mockResolvedValue(mockChat),
        addMessage: jest.fn().mockResolvedValue({
          id: 'msg-new',
          role: 'TOOL',
          content: '{}',
          createdAt: new Date().toISOString(),
        }),
      },
    },
    session: { user: { id: 'user-1' } },
  } as unknown as AuthenticatedContext;
}

describe('handleRunTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecuteToolCallWithContext.mockResolvedValue({
      toolName: 'search_memories',
      success: true,
      result: 'Found 3 memories',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('input validation', () => {
    it('returns validation error when toolName is missing', async () => {
      const req = createRequest({ arguments: {} });
      const ctx = createMockContext();

      const res = await handleRunTool(req, 'chat-123', ctx);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe('Validation error');
    });

    it('returns validation error when toolName is empty string', async () => {
      const req = createRequest({ toolName: '', arguments: {} });
      const ctx = createMockContext();

      const res = await handleRunTool(req, 'chat-123', ctx);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe('Validation error');
    });

    it('defaults arguments to empty object when not provided', async () => {
      const req = createRequest({ toolName: 'search_memories' });
      const ctx = createMockContext();

      const res = await handleRunTool(req, 'chat-123', ctx);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);

      expect(mockExecuteToolCallWithContext).toHaveBeenCalledWith(
        { name: 'search_memories', arguments: {} },
        expect.any(Object)
      );
    });
  });

  describe('blacklisted tools', () => {
    it('rejects submit_final_response tool', async () => {
      const req = createRequest({ toolName: 'submit_final_response' });
      const ctx = createMockContext();

      const res = await handleRunTool(req, 'chat-123', ctx);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain('submit_final_response');
      expect(data.error).toContain('cannot be invoked directly');
    });

    it('rejects request_full_context tool', async () => {
      const req = createRequest({ toolName: 'request_full_context' });
      const ctx = createMockContext();

      const res = await handleRunTool(req, 'chat-123', ctx);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain('request_full_context');
    });

    it('does not call executeToolCallWithContext for blacklisted tools', async () => {
      const req = createRequest({ toolName: 'submit_final_response' });
      const ctx = createMockContext();

      await handleRunTool(req, 'chat-123', ctx);

      expect(mockExecuteToolCallWithContext).not.toHaveBeenCalled();
    });
  });

  describe('chat lookup', () => {
    it('returns bad request when chat is not found', async () => {
      const req = createRequest({ toolName: 'search_memories' });
      const ctx = createMockContext({ chatData: null });

      const res = await handleRunTool(req, 'nonexistent-chat', ctx);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain('Chat not found');
    });
  });

  describe('successful execution', () => {
    it('executes tool with correct context', async () => {
      const req = createRequest({
        toolName: 'search_memories',
        arguments: { query: 'hello' },
      });
      const ctx = createMockContext();

      await handleRunTool(req, 'chat-123', ctx);

      expect(mockExecuteToolCallWithContext).toHaveBeenCalledWith(
        { name: 'search_memories', arguments: { query: 'hello' } },
        expect.objectContaining({
          chatId: 'chat-123',
          userId: 'user-1',
          characterId: 'char-1',
          imageProfileId: 'img-profile-1',
          callingParticipantId: 'participant-1',
        })
      );
    });

    it('returns success response with tool result', async () => {
      mockExecuteToolCallWithContext.mockResolvedValue({
        toolName: 'search_memories',
        success: true,
        result: 'Found 3 memories',
      });

      const req = createRequest({ toolName: 'search_memories', arguments: {} });
      const ctx = createMockContext();

      const res = await handleRunTool(req, 'chat-123', ctx);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.result.toolName).toBe('search_memories');
      expect(data.result.success).toBe(true);
      expect(data.result.result).toBe('Found 3 memories');
    });

    it('adds tool result message to chat', async () => {
      mockExecuteToolCallWithContext.mockResolvedValue({
        toolName: 'search_memories',
        success: true,
        result: 'Found memories',
      });

      const req = createRequest({ toolName: 'search_memories', arguments: { query: 'test' } });
      const ctx = createMockContext();

      await handleRunTool(req, 'chat-123', ctx);

      expect(ctx.repos.chats.addMessage).toHaveBeenCalledWith(
        'chat-123',
        expect.objectContaining({
          role: 'TOOL',
          type: 'message',
        })
      );

      // Verify the message content contains tool info
      const addMessageCall = (ctx.repos.chats.addMessage as jest.Mock).mock.calls[0];
      const messageContent = JSON.parse(addMessageCall[1].content);
      expect(messageContent.tool).toBe('search_memories');
      expect(messageContent.initiatedBy).toBe('user');
      expect(messageContent.success).toBe(true);
    });

    it('handles non-string tool results by JSON-stringifying them', async () => {
      mockExecuteToolCallWithContext.mockResolvedValue({
        toolName: 'search_memories',
        success: true,
        result: { matches: [{ text: 'memory 1' }] },
      });

      const req = createRequest({ toolName: 'search_memories', arguments: {} });
      const ctx = createMockContext();

      await handleRunTool(req, 'chat-123', ctx);

      const addMessageCall = (ctx.repos.chats.addMessage as jest.Mock).mock.calls[0];
      const messageContent = JSON.parse(addMessageCall[1].content);
      // Non-string result should be JSON-stringified
      expect(typeof messageContent.result).toBe('string');
      expect(JSON.parse(messageContent.result)).toEqual({ matches: [{ text: 'memory 1' }] });
    });

    it('handles chat with no active character participant', async () => {
      const ctx = createMockContext({
        chatData: {
          id: 'chat-123',
          title: 'Test Chat',
          projectId: null,
          participants: [],
        },
      });

      const req = createRequest({ toolName: 'search_memories', arguments: {} });

      const res = await handleRunTool(req, 'chat-123', ctx);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);

      // Context should have undefined for character-related fields
      expect(mockExecuteToolCallWithContext).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          characterId: undefined,
          imageProfileId: undefined,
          callingParticipantId: undefined,
        })
      );
    });

    it('includes projectId in execution context when chat has project', async () => {
      const ctx = createMockContext({
        chatData: {
          id: 'chat-123',
          title: 'Project Chat',
          projectId: 'project-99',
          participants: [],
        },
      });

      const req = createRequest({ toolName: 'project_info', arguments: {} });

      await handleRunTool(req, 'chat-123', ctx);

      expect(mockExecuteToolCallWithContext).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          projectId: 'project-99',
        })
      );
    });
  });

  describe('error handling', () => {
    it('returns server error when tool execution throws', async () => {
      mockExecuteToolCallWithContext.mockRejectedValue(new Error('Tool crashed'));

      const req = createRequest({ toolName: 'search_memories', arguments: {} });
      const ctx = createMockContext();

      const res = await handleRunTool(req, 'chat-123', ctx);
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error).toContain('Failed to execute tool');
    });

    it('returns server error when request body is invalid JSON', async () => {
      const req = new NextRequest('http://localhost:3000/api/v1/chats/chat-123?action=run-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      const ctx = createMockContext();

      const res = await handleRunTool(req, 'chat-123', ctx);

      expect(res.status).toBe(500);
    });

    it('builds human-readable prompt description with arguments', async () => {
      mockExecuteToolCallWithContext.mockResolvedValue({
        toolName: 'search_memories',
        success: true,
        result: 'ok',
      });

      const req = createRequest({
        toolName: 'search_memories',
        arguments: { query: 'hello world', limit: 5 },
      });
      const ctx = createMockContext();

      await handleRunTool(req, 'chat-123', ctx);

      const addMessageCall = (ctx.repos.chats.addMessage as jest.Mock).mock.calls[0];
      const messageContent = JSON.parse(addMessageCall[1].content);
      expect(messageContent.prompt).toContain('search_memories');
      expect(messageContent.prompt).toContain('query: hello world');
    });
  });
});
