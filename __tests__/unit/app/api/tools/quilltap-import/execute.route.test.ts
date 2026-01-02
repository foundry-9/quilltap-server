/**
 * Unit tests for Quilltap Import Execute API route
 * Tests: POST /api/tools/quilltap-import/execute
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { NextRequest } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { createMockRepositoryContainer, setupAuthMocks, type MockRepositoryContainer } from '@/__tests__/unit/lib/fixtures/mock-repositories';

// Create mock repos before jest.mock
const mockRepos = createMockRepositoryContainer();

// Mock dependencies
jest.mock('@/lib/auth/session', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(() => mockRepos),
  getUserRepositories: jest.fn(),
}));

jest.mock('@/lib/import/quilltap-import-service', () => ({
  executeImport: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),
  },
}));

const mockGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>;

// Get the mocked module
const importServiceMock = jest.requireMock('@/lib/import/quilltap-import-service') as {
  executeImport: jest.Mock;
};
const mockExecuteImport = importServiceMock.executeImport;

let POST: typeof import('@/app/api/tools/quilltap-import/execute/route').POST;

describe('Quilltap Import Execute API Route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecuteImport.mockReset();

    jest.isolateModules(() => {
      const routesModule = require('@/app/api/tools/quilltap-import/execute/route');
      POST = routesModule.POST;
    });

    // Setup auth mocks
    setupAuthMocks(mockGetServerSession, mockRepos);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const validExportData = {
    manifest: {
      format: 'quilltap-export',
      version: '1.0',
      exportType: 'characters',
      exportedAt: '2024-01-01T00:00:00.000Z',
      counts: { characters: 2 },
    },
    data: {
      characters: [
        { id: 'char-1', name: 'Character 1' },
        { id: 'char-2', name: 'Character 2' },
      ],
    },
  };

  const mockImportResult = {
    success: true,
    imported: { characters: 2, personas: 0, chats: 0, tags: 0 },
    skipped: { characters: 0, personas: 0, chats: 0, tags: 0 },
    warnings: [],
  };

  // ============================================================================
  // Authentication Tests
  // ============================================================================
  describe('Authentication', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetServerSession.mockResolvedValueOnce(null as any);

      const request = {
        json: async () => ({
          exportData: validExportData,
          options: { conflictStrategy: 'skip', importMemories: false },
        }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body).toEqual({ error: 'Unauthorized' });
      expect(mockExecuteImport).not.toHaveBeenCalled();
    });

    it('should return 401 when session has no user', async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: null } as any);

      const request = {
        json: async () => ({
          exportData: validExportData,
          options: { conflictStrategy: 'skip', importMemories: false },
        }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body).toEqual({ error: 'Unauthorized' });
    });
  });

  // ============================================================================
  // Request Validation Tests
  // ============================================================================
  describe('Request Validation', () => {
    it('should return 400 when exportData is missing', async () => {
      const request = {
        json: async () => ({
          options: { conflictStrategy: 'skip', importMemories: false },
        }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('Missing required field: exportData');
    });

    it('should return 400 when options is missing', async () => {
      const request = {
        json: async () => ({
          exportData: validExportData,
        }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('Missing required field: options');
    });

    it('should return 400 when conflictStrategy is missing', async () => {
      const request = {
        json: async () => ({
          exportData: validExportData,
          options: { importMemories: false },
        }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('Invalid conflictStrategy');
    });

    it('should return 400 for invalid conflictStrategy value', async () => {
      const request = {
        json: async () => ({
          exportData: validExportData,
          options: { conflictStrategy: 'invalid', importMemories: false },
        }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('Invalid conflictStrategy');
      expect(body.error).toContain('skip, replace, duplicate');
    });
  });

  // ============================================================================
  // Conflict Strategy Tests
  // ============================================================================
  describe('Conflict Strategies', () => {
    it('should execute import with skip strategy', async () => {
      mockExecuteImport.mockResolvedValue(mockImportResult as any);

      const request = {
        json: async () => ({
          exportData: validExportData,
          options: { conflictStrategy: 'skip', importMemories: false },
        }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(mockExecuteImport).toHaveBeenCalledWith(
        'user-123',
        validExportData,
        expect.objectContaining({
          conflictStrategy: 'skip',
          includeMemories: false,
          includeRelatedEntities: false,
        })
      );
    });

    it('should map replace strategy to overwrite', async () => {
      mockExecuteImport.mockResolvedValue(mockImportResult as any);

      const request = {
        json: async () => ({
          exportData: validExportData,
          options: { conflictStrategy: 'replace', importMemories: false },
        }),
      } as unknown as NextRequest;

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockExecuteImport).toHaveBeenCalledWith(
        'user-123',
        validExportData,
        expect.objectContaining({
          conflictStrategy: 'overwrite', // 'replace' mapped to 'overwrite'
        })
      );
    });

    it('should execute import with duplicate strategy', async () => {
      mockExecuteImport.mockResolvedValue(mockImportResult as any);

      const request = {
        json: async () => ({
          exportData: validExportData,
          options: { conflictStrategy: 'duplicate', importMemories: true },
        }),
      } as unknown as NextRequest;

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockExecuteImport).toHaveBeenCalledWith(
        'user-123',
        validExportData,
        expect.objectContaining({
          conflictStrategy: 'duplicate',
          includeMemories: true,
        })
      );
    });
  });

  // ============================================================================
  // Options Handling Tests
  // ============================================================================
  describe('Options Handling', () => {
    it('should pass importMemories option correctly', async () => {
      mockExecuteImport.mockResolvedValue(mockImportResult as any);

      const request = {
        json: async () => ({
          exportData: validExportData,
          options: { conflictStrategy: 'skip', importMemories: true },
        }),
      } as unknown as NextRequest;

      const response = await POST(request);

      expect(mockExecuteImport).toHaveBeenCalledWith(
        'user-123',
        validExportData,
        expect.objectContaining({
          includeMemories: true,
        })
      );
    });

    it('should default importMemories to false when not provided', async () => {
      mockExecuteImport.mockResolvedValue(mockImportResult as any);

      const request = {
        json: async () => ({
          exportData: validExportData,
          options: { conflictStrategy: 'skip' },
        }),
      } as unknown as NextRequest;

      const response = await POST(request);

      expect(mockExecuteImport).toHaveBeenCalledWith(
        'user-123',
        validExportData,
        expect.objectContaining({
          includeMemories: false,
        })
      );
    });

    it('should pass selectedIds when provided', async () => {
      mockExecuteImport.mockResolvedValue(mockImportResult as any);

      const request = {
        json: async () => ({
          exportData: validExportData,
          options: {
            conflictStrategy: 'skip',
            importMemories: false,
            selectedIds: {
              characters: ['char-1'],
            },
          },
        }),
      } as unknown as NextRequest;

      const response = await POST(request);

      expect(mockExecuteImport).toHaveBeenCalledWith(
        'user-123',
        validExportData,
        expect.objectContaining({
          selectedIds: { characters: ['char-1'] },
        })
      );
    });
  });

  // ============================================================================
  // Response Structure Tests
  // ============================================================================
  describe('Response Structure', () => {
    it('should return success with import counts', async () => {
      const result = {
        success: true,
        imported: { characters: 2, personas: 1, chats: 0, tags: 3 },
        skipped: { characters: 1, personas: 0, chats: 0, tags: 0 },
        warnings: ['Some entity was skipped'],
      };
      mockExecuteImport.mockResolvedValue(result as any);

      const request = {
        json: async () => ({
          exportData: validExportData,
          options: { conflictStrategy: 'skip', importMemories: false },
        }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual(result);
    });

    it('should return result even when import reports success false', async () => {
      const result = {
        success: false,
        imported: { characters: 0 },
        skipped: { characters: 2 },
        warnings: ['All entities failed to import'],
      };
      mockExecuteImport.mockResolvedValue(result as any);

      const request = {
        json: async () => ({
          exportData: validExportData,
          options: { conflictStrategy: 'skip', importMemories: false },
        }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(false);
      expect(body.warnings).toContain('All entities failed to import');
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================
  describe('Error Handling', () => {
    it('should return 500 when executeImport throws', async () => {
      mockExecuteImport.mockRejectedValue(new Error('Database connection failed'));

      const request = {
        json: async () => ({
          exportData: validExportData,
          options: { conflictStrategy: 'skip', importMemories: false },
        }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toContain('Database connection failed');
    });

    it('should return 500 with generic message for non-Error throws', async () => {
      mockExecuteImport.mockRejectedValue('String error');

      const request = {
        json: async () => ({
          exportData: validExportData,
          options: { conflictStrategy: 'skip', importMemories: false },
        }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBeDefined();
    });
  });
});
