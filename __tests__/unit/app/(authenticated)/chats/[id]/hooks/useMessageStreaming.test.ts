/**
 * Unit tests for useMessageStreaming hook
 * Tests streaming state management, abort controller handling, and cleanup
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import { useMessageStreaming, PendingToolCall, ToolExecutionStatus } from '@/app/(authenticated)/chats/[id]/hooks/useMessageStreaming';
import type { Message, Participant } from '@/app/(authenticated)/chats/[id]/types';

// Mock toast
jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}));

// Mock error-utils
jest.mock('@/lib/error-utils', () => ({
  getErrorMessage: jest.fn((error: unknown) => {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'Unknown error';
  }),
}));

// Create default mock params for the hook
function createMockParams(overrides: Partial<Parameters<typeof useMessageStreaming>[0]> = {}) {
  return {
    chatId: 'test-chat-id',
    messages: [] as Message[],
    participantsAsBase: [] as { id: string; type: 'CHARACTER' | 'PERSONA'; isActive: boolean }[],
    chat: null as { participants: Participant[] } | null,
    isMultiChar: false,
    scrollToBottom: jest.fn(),
    fetchChat: jest.fn().mockResolvedValue(undefined) as () => Promise<void>,
    debug: undefined,
    setSending: jest.fn(),
    setStreaming: jest.fn(),
    setStreamingContent: jest.fn(),
    setWaitingForResponse: jest.fn(),
    setRespondingParticipantId: jest.fn(),
    setPendingToolCalls: jest.fn(),
    setToolExecutionStatus: jest.fn(),
    setMessages: jest.fn(),
    ...overrides,
  };
}

describe('useMessageStreaming', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ============================================================================
  // Initial State Tests
  // ============================================================================
  describe('Initial state', () => {
    it('should return abortControllerRef initialized to null', () => {
      const params = createMockParams();
      const { result } = renderHook(() => useMessageStreaming(params));

      expect(result.current.abortControllerRef.current).toBeNull();
    });

    it('should return userStoppedStreamRef initialized to false', () => {
      const params = createMockParams();
      const { result } = renderHook(() => useMessageStreaming(params));

      expect(result.current.userStoppedStreamRef.current).toBe(false);
    });

    it('should provide stopStreaming function', () => {
      const params = createMockParams();
      const { result } = renderHook(() => useMessageStreaming(params));

      expect(typeof result.current.stopStreaming).toBe('function');
    });

    it('should provide triggerContinueMode function', () => {
      const params = createMockParams();
      const { result } = renderHook(() => useMessageStreaming(params));

      expect(typeof result.current.triggerContinueMode).toBe('function');
    });
  });

  // ============================================================================
  // Starting a Stream Tests
  // ============================================================================
  describe('Starting a stream', () => {
    it('should allow setting abortControllerRef with a new AbortController', () => {
      const params = createMockParams();
      const { result } = renderHook(() => useMessageStreaming(params));

      const controller = new AbortController();

      act(() => {
        result.current.abortControllerRef.current = controller;
      });

      expect(result.current.abortControllerRef.current).toBe(controller);
      expect(result.current.abortControllerRef.current?.signal.aborted).toBe(false);
    });

    it('should allow replacing AbortController for new streams', () => {
      const params = createMockParams();
      const { result } = renderHook(() => useMessageStreaming(params));

      const firstController = new AbortController();
      const secondController = new AbortController();

      act(() => {
        result.current.abortControllerRef.current = firstController;
      });

      expect(result.current.abortControllerRef.current).toBe(firstController);

      act(() => {
        result.current.abortControllerRef.current = secondController;
      });

      expect(result.current.abortControllerRef.current).toBe(secondController);
    });
  });

  // ============================================================================
  // Aborting a Stream Tests
  // ============================================================================
  describe('Aborting a stream', () => {
    it('should abort the current AbortController when stopStreaming is called', () => {
      const params = createMockParams();
      const { result } = renderHook(() => useMessageStreaming(params));

      const controller = new AbortController();

      act(() => {
        result.current.abortControllerRef.current = controller;
      });

      expect(controller.signal.aborted).toBe(false);

      act(() => {
        result.current.stopStreaming();
      });

      expect(controller.signal.aborted).toBe(true);
    });

    it('should set abortControllerRef to null after aborting', () => {
      const params = createMockParams();
      const { result } = renderHook(() => useMessageStreaming(params));

      const controller = new AbortController();

      act(() => {
        result.current.abortControllerRef.current = controller;
        result.current.stopStreaming();
      });

      expect(result.current.abortControllerRef.current).toBeNull();
    });

    it('should reset all streaming state when stopStreaming is called', () => {
      const mockSetSending = jest.fn();
      const mockSetStreaming = jest.fn();
      const mockSetStreamingContent = jest.fn();
      const mockSetWaitingForResponse = jest.fn();
      const mockSetRespondingParticipantId = jest.fn();
      const mockSetPendingToolCalls = jest.fn();
      const mockSetToolExecutionStatus = jest.fn();

      const params = createMockParams({
        setSending: mockSetSending,
        setStreaming: mockSetStreaming,
        setStreamingContent: mockSetStreamingContent,
        setWaitingForResponse: mockSetWaitingForResponse,
        setRespondingParticipantId: mockSetRespondingParticipantId,
        setPendingToolCalls: mockSetPendingToolCalls,
        setToolExecutionStatus: mockSetToolExecutionStatus,
      });

      const { result } = renderHook(() => useMessageStreaming(params));

      act(() => {
        result.current.abortControllerRef.current = new AbortController();
        result.current.stopStreaming();
      });

      expect(mockSetStreaming).toHaveBeenCalledWith(false);
      expect(mockSetWaitingForResponse).toHaveBeenCalledWith(false);
      expect(mockSetSending).toHaveBeenCalledWith(false);
      expect(mockSetRespondingParticipantId).toHaveBeenCalledWith(null);
      expect(mockSetPendingToolCalls).toHaveBeenCalledWith([]);
      expect(mockSetToolExecutionStatus).toHaveBeenCalledWith(null);
      expect(mockSetStreamingContent).toHaveBeenCalledWith('');
    });

    it('should not throw when stopping streaming (logs debug internally)', () => {
      const params = createMockParams();
      const { result } = renderHook(() => useMessageStreaming(params));

      // The hook internally calls clientLogger.debug - we verify it doesn't throw
      expect(() => {
        act(() => {
          result.current.abortControllerRef.current = new AbortController();
          result.current.stopStreaming();
        });
      }).not.toThrow();
    });

    it('should handle stopStreaming when abortControllerRef is already null', () => {
      const mockSetSending = jest.fn();
      const mockSetStreaming = jest.fn();

      const params = createMockParams({
        setSending: mockSetSending,
        setStreaming: mockSetStreaming,
      });

      const { result } = renderHook(() => useMessageStreaming(params));

      // abortControllerRef is null by default
      expect(result.current.abortControllerRef.current).toBeNull();

      // Should not throw when calling stopStreaming with null controller
      expect(() => {
        act(() => {
          result.current.stopStreaming();
        });
      }).not.toThrow();

      // State should still be reset
      expect(mockSetStreaming).toHaveBeenCalledWith(false);
      expect(mockSetSending).toHaveBeenCalledWith(false);
    });
  });

  // ============================================================================
  // Multi-Character Chat Tests
  // ============================================================================
  describe('Multi-character chat behavior', () => {
    it('should set userStoppedStreamRef to true in multi-char mode when stopping', () => {
      const params = createMockParams({ isMultiChar: true });
      const { result } = renderHook(() => useMessageStreaming(params));

      expect(result.current.userStoppedStreamRef.current).toBe(false);

      act(() => {
        result.current.abortControllerRef.current = new AbortController();
        result.current.stopStreaming();
      });

      expect(result.current.userStoppedStreamRef.current).toBe(true);
    });

    it('should not set userStoppedStreamRef in single-char mode when stopping', () => {
      const params = createMockParams({ isMultiChar: false });
      const { result } = renderHook(() => useMessageStreaming(params));

      expect(result.current.userStoppedStreamRef.current).toBe(false);

      act(() => {
        result.current.abortControllerRef.current = new AbortController();
        result.current.stopStreaming();
      });

      expect(result.current.userStoppedStreamRef.current).toBe(false);
    });

    it('should not throw when setting userStoppedStreamRef in multi-char mode (logs debug internally)', () => {
      const params = createMockParams({ isMultiChar: true });
      const { result } = renderHook(() => useMessageStreaming(params));

      // The hook internally calls clientLogger.debug - we verify it doesn't throw
      expect(() => {
        act(() => {
          result.current.stopStreaming();
        });
      }).not.toThrow();

      // Verify the ref was set correctly
      expect(result.current.userStoppedStreamRef.current).toBe(true);
    });
  });

  // ============================================================================
  // Cleanup on Unmount Tests
  // ============================================================================
  describe('Cleanup on unmount', () => {
    it('should not have memory leaks - refs should be accessible after unmount', () => {
      const params = createMockParams();
      const { result, unmount } = renderHook(() => useMessageStreaming(params));

      const controller = new AbortController();

      act(() => {
        result.current.abortControllerRef.current = controller;
      });

      // Unmount the hook
      unmount();

      // The controller should have been the same reference
      expect(controller.signal.aborted).toBe(false);
    });

    it('should maintain ref values between renders', () => {
      const params = createMockParams();
      const { result, rerender } = renderHook(() => useMessageStreaming(params));

      const controller = new AbortController();

      act(() => {
        result.current.abortControllerRef.current = controller;
      });

      // Rerender the hook
      rerender();

      // The ref should maintain its value
      expect(result.current.abortControllerRef.current).toBe(controller);
    });

    it('should maintain userStoppedStreamRef value between renders', () => {
      const params = createMockParams({ isMultiChar: true });
      const { result, rerender } = renderHook(() => useMessageStreaming(params));

      act(() => {
        result.current.stopStreaming();
      });

      expect(result.current.userStoppedStreamRef.current).toBe(true);

      // Rerender the hook
      rerender();

      // The ref should maintain its value
      expect(result.current.userStoppedStreamRef.current).toBe(true);
    });
  });

  // ============================================================================
  // AbortController Creation and Management Tests
  // ============================================================================
  describe('AbortController creation and management', () => {
    it('should create independent AbortControllers', () => {
      const params = createMockParams();
      const { result } = renderHook(() => useMessageStreaming(params));

      const controller1 = new AbortController();
      const controller2 = new AbortController();

      act(() => {
        result.current.abortControllerRef.current = controller1;
        controller1.abort();
      });

      expect(controller1.signal.aborted).toBe(true);

      act(() => {
        result.current.abortControllerRef.current = controller2;
      });

      expect(controller2.signal.aborted).toBe(false);
    });

    it('should properly handle AbortController signal state', () => {
      const params = createMockParams();
      const { result } = renderHook(() => useMessageStreaming(params));

      const controller = new AbortController();

      act(() => {
        result.current.abortControllerRef.current = controller;
      });

      // Signal should not be aborted initially
      expect(result.current.abortControllerRef.current?.signal.aborted).toBe(false);

      act(() => {
        result.current.stopStreaming();
      });

      // Controller was aborted and ref was set to null
      expect(result.current.abortControllerRef.current).toBeNull();
      // The original controller should be aborted
      expect(controller.signal.aborted).toBe(true);
    });
  });

  // ============================================================================
  // Memory Leak Prevention Tests
  // ============================================================================
  describe('Memory leak prevention', () => {
    it('should clean up AbortController reference when stopping', () => {
      const params = createMockParams();
      const { result } = renderHook(() => useMessageStreaming(params));

      // Create and set a controller
      const controller = new AbortController();
      act(() => {
        result.current.abortControllerRef.current = controller;
      });

      // Stop streaming - should clear the ref
      act(() => {
        result.current.stopStreaming();
      });

      // Ref should be null, preventing memory leaks from holding controller reference
      expect(result.current.abortControllerRef.current).toBeNull();
    });

    it('should allow garbage collection by clearing refs', () => {
      const params = createMockParams();
      const { result } = renderHook(() => useMessageStreaming(params));

      // Simulate multiple stream cycles
      for (let i = 0; i < 5; i++) {
        act(() => {
          result.current.abortControllerRef.current = new AbortController();
        });

        act(() => {
          result.current.stopStreaming();
        });

        // After each stop, ref should be null
        expect(result.current.abortControllerRef.current).toBeNull();
      }
    });

    it('should reset streamingContent to empty string on stop', () => {
      const mockSetStreamingContent = jest.fn();
      const params = createMockParams({
        setStreamingContent: mockSetStreamingContent,
      });

      const { result } = renderHook(() => useMessageStreaming(params));

      act(() => {
        result.current.stopStreaming();
      });

      // Streaming content should be cleared to prevent memory from holding large strings
      expect(mockSetStreamingContent).toHaveBeenCalledWith('');
    });
  });

  // ============================================================================
  // triggerContinueMode Tests
  // ============================================================================
  describe('triggerContinueMode', () => {
    it('should be a callable async function', async () => {
      const params = createMockParams();
      const { result } = renderHook(() => useMessageStreaming(params));

      // Should not throw when called
      await expect(
        act(async () => {
          await result.current.triggerContinueMode('participant-1');
        })
      ).resolves.not.toThrow();
    });

    it('should not throw when called with participantId (logs debug internally)', async () => {
      const params = createMockParams();
      const { result } = renderHook(() => useMessageStreaming(params));

      // The hook internally calls clientLogger.debug - we verify it doesn't throw
      await expect(
        act(async () => {
          await result.current.triggerContinueMode('test-participant-id');
        })
      ).resolves.not.toThrow();
    });
  });

  // ============================================================================
  // Callback Stability Tests
  // ============================================================================
  describe('Callback stability', () => {
    it('should maintain stopStreaming reference identity when deps do not change', () => {
      const params = createMockParams();
      const { result, rerender } = renderHook(() => useMessageStreaming(params));

      const firstStopStreaming = result.current.stopStreaming;

      rerender();

      const secondStopStreaming = result.current.stopStreaming;

      // With stable deps, the callback should be the same reference
      expect(firstStopStreaming).toBe(secondStopStreaming);
    });

    it('should update stopStreaming when isMultiChar changes', () => {
      let isMultiChar = false;
      const params = createMockParams({ isMultiChar });

      const { result, rerender } = renderHook(
        ({ isMultiChar }) => useMessageStreaming(createMockParams({ isMultiChar })),
        { initialProps: { isMultiChar: false } }
      );

      const firstStopStreaming = result.current.stopStreaming;

      rerender({ isMultiChar: true });

      const secondStopStreaming = result.current.stopStreaming;

      // With different deps, the callback should be a different reference
      expect(firstStopStreaming).not.toBe(secondStopStreaming);
    });
  });

  // ============================================================================
  // Edge Cases Tests
  // ============================================================================
  describe('Edge cases', () => {
    it('should handle rapid stop/start cycles', () => {
      const params = createMockParams();
      const { result } = renderHook(() => useMessageStreaming(params));

      // Rapid cycling through start/stop
      for (let i = 0; i < 10; i++) {
        act(() => {
          result.current.abortControllerRef.current = new AbortController();
          result.current.stopStreaming();
        });
      }

      expect(result.current.abortControllerRef.current).toBeNull();
    });

    it('should handle stopStreaming called multiple times in succession', () => {
      const mockSetStreaming = jest.fn();
      const params = createMockParams({ setStreaming: mockSetStreaming });
      const { result } = renderHook(() => useMessageStreaming(params));

      act(() => {
        result.current.abortControllerRef.current = new AbortController();
      });

      act(() => {
        result.current.stopStreaming();
        result.current.stopStreaming();
        result.current.stopStreaming();
      });

      // setStreaming should be called each time
      expect(mockSetStreaming).toHaveBeenCalledTimes(3);
    });

    it('should work with debug parameter provided', () => {
      const mockDebug = {
        isDebugMode: true,
        addEntry: jest.fn().mockReturnValue('entry-id'),
        updateEntry: jest.fn(),
        appendToEntry: jest.fn(),
        finalizeStreamingEntry: jest.fn(),
      };

      const params = createMockParams({ debug: mockDebug });
      const { result } = renderHook(() => useMessageStreaming(params));

      // Hook should initialize properly with debug params
      expect(result.current.abortControllerRef.current).toBeNull();
      expect(result.current.stopStreaming).toBeDefined();
    });

    it('should work with messages and participants provided', () => {
      const messages: Message[] = [
        { id: 'msg-1', role: 'user', content: 'Hello', createdAt: new Date().toISOString() },
        { id: 'msg-2', role: 'assistant', content: 'Hi there', createdAt: new Date().toISOString() },
      ];

      const participantsAsBase = [
        { id: 'char-1', type: 'CHARACTER' as const, isActive: true },
      ];

      const chat = {
        participants: [
          {
            id: 'participant-1',
            type: 'CHARACTER' as const,
            displayOrder: 0,
            isActive: true,
          },
        ],
      };

      const params = createMockParams({
        messages,
        participantsAsBase,
        chat,
      });

      const { result } = renderHook(() => useMessageStreaming(params));

      // Hook should initialize properly
      expect(result.current.abortControllerRef.current).toBeNull();
      expect(result.current.stopStreaming).toBeDefined();
    });
  });

  // ============================================================================
  // Integration-style Tests
  // ============================================================================
  describe('Integration scenarios', () => {
    it('should handle complete streaming lifecycle: start -> stream -> stop', () => {
      const mockSetSending = jest.fn();
      const mockSetStreaming = jest.fn();
      const mockSetStreamingContent = jest.fn();

      const params = createMockParams({
        setSending: mockSetSending,
        setStreaming: mockSetStreaming,
        setStreamingContent: mockSetStreamingContent,
      });

      const { result } = renderHook(() => useMessageStreaming(params));

      // 1. Start streaming (external code would call these setters)
      const controller = new AbortController();
      act(() => {
        result.current.abortControllerRef.current = controller;
      });

      expect(result.current.abortControllerRef.current).not.toBeNull();

      // 2. User decides to stop
      act(() => {
        result.current.stopStreaming();
      });

      // 3. Verify cleanup occurred
      expect(result.current.abortControllerRef.current).toBeNull();
      expect(controller.signal.aborted).toBe(true);
      expect(mockSetStreaming).toHaveBeenCalledWith(false);
      expect(mockSetSending).toHaveBeenCalledWith(false);
      expect(mockSetStreamingContent).toHaveBeenCalledWith('');
    });

    it('should handle multi-char auto-response prevention workflow', () => {
      const params = createMockParams({ isMultiChar: true });
      const { result } = renderHook(() => useMessageStreaming(params));

      // User stops a multi-char stream
      act(() => {
        result.current.abortControllerRef.current = new AbortController();
        result.current.stopStreaming();
      });

      // userStoppedStreamRef should be set to prevent auto-triggering
      expect(result.current.userStoppedStreamRef.current).toBe(true);

      // External code could reset this when appropriate
      act(() => {
        result.current.userStoppedStreamRef.current = false;
      });

      expect(result.current.userStoppedStreamRef.current).toBe(false);
    });
  });
});
