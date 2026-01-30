/**
 * Tests for LLM Log Cleanup Job Handler
 */

import { handleLLMLogCleanup } from '@/lib/background-jobs/handlers/llm-log-cleanup';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import { BackgroundJob } from '@/lib/schemas/types';

// Mock dependencies
jest.mock('@/lib/repositories/factory');
jest.mock('@/lib/logger');

const mockGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>;
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('LLM Log Cleanup Job Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLogger.child.mockReturnValue(logger);
  });

  describe('handleLLMLogCleanup', () => {
    it('should skip cleanup if retention is 0 (keep forever)', async () => {
      const mockChatSettingsRepo = {
        findByUserId: jest.fn().mockResolvedValue({
          userId: 'user-123',
          llmLoggingSettings: {
            enabled: true,
            retentionDays: 0,
          },
        }),
      };

      const mockLLMLogsRepo = {
        cleanupOldLogs: jest.fn(),
      };

      mockGetRepositories.mockReturnValue({
        chatSettings: mockChatSettingsRepo as any,
        llmLogs: mockLLMLogsRepo as any,
      } as any);

      const job: BackgroundJob = {
        id: 'job-123',
        userId: 'user-123',
        type: 'LLM_LOG_CLEANUP',
        status: 'PROCESSING',
        payload: {
          userId: 'user-123',
        },
        priority: 0,
        attempts: 0,
        maxAttempts: 3,
        lastError: null,
        scheduledAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await handleLLMLogCleanup(job);

      expect(mockLLMLogsRepo.cleanupOldLogs).not.toHaveBeenCalled();
    });

    it('should skip cleanup if logging is disabled', async () => {
      const mockChatSettingsRepo = {
        findByUserId: jest.fn().mockResolvedValue({
          userId: 'user-123',
          llmLoggingSettings: {
            enabled: false,
            retentionDays: 30,
          },
        }),
      };

      const mockLLMLogsRepo = {
        cleanupOldLogs: jest.fn(),
      };

      mockGetRepositories.mockReturnValue({
        chatSettings: mockChatSettingsRepo as any,
        llmLogs: mockLLMLogsRepo as any,
      } as any);

      const job: BackgroundJob = {
        id: 'job-123',
        userId: 'user-123',
        type: 'LLM_LOG_CLEANUP',
        status: 'PROCESSING',
        payload: {
          userId: 'user-123',
        },
        priority: 0,
        attempts: 0,
        maxAttempts: 3,
        lastError: null,
        scheduledAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await handleLLMLogCleanup(job);

      expect(mockLLMLogsRepo.cleanupOldLogs).not.toHaveBeenCalled();
    });

    it('should cleanup old logs with specified retention days', async () => {
      const mockChatSettingsRepo = {
        findByUserId: jest.fn().mockResolvedValue({
          userId: 'user-123',
          llmLoggingSettings: {
            enabled: true,
            retentionDays: 30,
          },
        }),
      };

      const mockLLMLogsRepo = {
        cleanupOldLogs: jest.fn().mockResolvedValue(42),
      };

      mockGetRepositories.mockReturnValue({
        chatSettings: mockChatSettingsRepo as any,
        llmLogs: mockLLMLogsRepo as any,
      } as any);

      const job: BackgroundJob = {
        id: 'job-123',
        userId: 'user-123',
        type: 'LLM_LOG_CLEANUP',
        status: 'PROCESSING',
        payload: {
          userId: 'user-123',
        },
        priority: 0,
        attempts: 0,
        maxAttempts: 3,
        lastError: null,
        scheduledAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await handleLLMLogCleanup(job);

      expect(mockLLMLogsRepo.cleanupOldLogs).toHaveBeenCalledWith('user-123', 30);
    });

    it('should use override retention days from payload if provided', async () => {
      const mockChatSettingsRepo = {
        findByUserId: jest.fn().mockResolvedValue({
          userId: 'user-123',
          llmLoggingSettings: {
            enabled: true,
            retentionDays: 30,
          },
        }),
      };

      const mockLLMLogsRepo = {
        cleanupOldLogs: jest.fn().mockResolvedValue(10),
      };

      mockGetRepositories.mockReturnValue({
        chatSettings: mockChatSettingsRepo as any,
        llmLogs: mockLLMLogsRepo as any,
      } as any);

      const job: BackgroundJob = {
        id: 'job-123',
        userId: 'user-123',
        type: 'LLM_LOG_CLEANUP',
        status: 'PROCESSING',
        payload: {
          userId: 'user-123',
          retentionDays: 7, // Override to 7 days
        },
        priority: 0,
        attempts: 0,
        maxAttempts: 3,
        lastError: null,
        scheduledAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await handleLLMLogCleanup(job);

      expect(mockLLMLogsRepo.cleanupOldLogs).toHaveBeenCalledWith('user-123', 7);
    });

    it('should skip cleanup gracefully if chat settings not found', async () => {
      const mockChatSettingsRepo = {
        findByUserId: jest.fn().mockResolvedValue(null),
      };

      mockGetRepositories.mockReturnValue({
        chatSettings: mockChatSettingsRepo as any,
      } as any);

      const job: BackgroundJob = {
        id: 'job-123',
        userId: 'user-123',
        type: 'LLM_LOG_CLEANUP',
        status: 'PROCESSING',
        payload: {
          userId: 'user-123',
        },
        priority: 0,
        attempts: 0,
        maxAttempts: 3,
        lastError: null,
        scheduledAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Should not throw, just return gracefully
      await handleLLMLogCleanup(job);
      expect(mockChatSettingsRepo.findByUserId).toHaveBeenCalledWith('user-123');
    });
  });
});
