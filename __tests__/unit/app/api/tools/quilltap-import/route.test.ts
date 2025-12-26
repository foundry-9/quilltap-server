/**
 * Unit tests for Quilltap Import Preview API route
 * Tests: POST /api/tools/quilltap-import (Preview)
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { NextRequest } from 'next/server';
import { getServerSession } from '@/lib/auth/session';

// Mock dependencies
jest.mock('@/lib/auth/session', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('@/lib/import/quilltap-import-service', () => ({
  previewImport: jest.fn(),
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
  previewImport: jest.Mock;
};
const mockPreviewImport = importServiceMock.previewImport;

let POST: typeof import('@/app/api/tools/quilltap-import/route').POST;

describe('Quilltap Import Preview API Route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPreviewImport.mockReset();

    jest.isolateModules(() => {
      const routesModule = require('@/app/api/tools/quilltap-import/route');
      POST = routesModule.POST;
    });

    // Default authenticated session
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-123', email: 'test@example.com' },
    } as any);
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

  const mockPreviewResult = {
    manifest: validExportData.manifest,
    entities: {
      characters: [
        { id: 'char-1', name: 'Character 1', exists: false },
        { id: 'char-2', name: 'Character 2', exists: true },
      ],
    },
    conflictCounts: { characters: 1 },
    warnings: [],
  };

  // ============================================================================
  // Authentication Tests
  // ============================================================================
  describe('Authentication', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetServerSession.mockResolvedValueOnce(null as any);

      const request = {
        headers: { get: () => 'application/json' },
        json: async () => ({ exportData: validExportData }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body).toEqual({ error: 'Unauthorized' });
      expect(mockPreviewImport).not.toHaveBeenCalled();
    });

    it('should return 401 when session has no user', async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: null } as any);

      const request = {
        headers: { get: () => 'application/json' },
        json: async () => ({ exportData: validExportData }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body).toEqual({ error: 'Unauthorized' });
    });
  });

  // ============================================================================
  // JSON Body Request Tests
  // ============================================================================
  describe('JSON Body Requests', () => {
    it('should preview import from JSON body exportData', async () => {
      mockPreviewImport.mockResolvedValue(mockPreviewResult as any);

      const request = {
        headers: { get: () => 'application/json' },
        json: async () => ({ exportData: validExportData }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.manifest.format).toBe('quilltap-export');
      expect(body.entities.characters).toHaveLength(2);
      expect(mockPreviewImport).toHaveBeenCalledWith('user-123', validExportData);
    });

    it('should return 400 when exportData is missing in JSON body', async () => {
      const request = {
        headers: { get: () => 'application/json' },
        json: async () => ({}),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('Missing required field: exportData');
    });
  });

  // ============================================================================
  // FormData File Upload Tests
  // ============================================================================
  describe('FormData File Upload', () => {
    it('should preview import from uploaded file', async () => {
      mockPreviewImport.mockResolvedValue(mockPreviewResult as any);

      const fileContent = JSON.stringify(validExportData);
      const mockFile = {
        name: 'export.qtap',
        size: fileContent.length,
        text: async () => fileContent,
      };

      const request = {
        headers: { get: () => 'multipart/form-data; boundary=...' },
        formData: async () => ({
          get: (key: string) => (key === 'file' ? mockFile : null),
        }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(mockPreviewImport).toHaveBeenCalledWith('user-123', validExportData);
    });

    it('should return 400 when no file is provided', async () => {
      const request = {
        headers: { get: () => 'multipart/form-data; boundary=...' },
        formData: async () => ({
          get: () => null,
        }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('No file provided');
    });

    it('should return 400 when file is too large', async () => {
      const mockFile = {
        name: 'export.qtap',
        size: 150 * 1024 * 1024, // 150MB, exceeds 100MB limit
        text: async () => '{}',
      };

      const request = {
        headers: { get: () => 'multipart/form-data; boundary=...' },
        formData: async () => ({
          get: (key: string) => (key === 'file' ? mockFile : null),
        }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('File too large');
    });
  });

  // ============================================================================
  // Export Format Validation Tests
  // ============================================================================
  describe('Export Format Validation', () => {
    it('should return 400 for invalid JSON', async () => {
      const mockFile = {
        name: 'export.qtap',
        size: 100,
        text: async () => 'not valid json {{{',
      };

      const request = {
        headers: { get: () => 'multipart/form-data; boundary=...' },
        formData: async () => ({
          get: (key: string) => (key === 'file' ? mockFile : null),
        }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(500); // parseExportFile throws, caught by error handler
      expect(body.error).toContain('Invalid JSON');
    });

    it('should return 400 for non-object JSON', async () => {
      const request = {
        headers: { get: () => 'application/json' },
        json: async () => ({ exportData: 'string-not-object' }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('Invalid export file format');
    });

    it('should return 400 for missing manifest', async () => {
      const invalidExport = {
        data: { characters: [] },
      };

      const request = {
        headers: { get: () => 'application/json' },
        json: async () => ({ exportData: invalidExport }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('Invalid export file format');
    });

    it('should return 400 for wrong format identifier', async () => {
      const invalidExport = {
        manifest: {
          format: 'wrong-format',
          version: '1.0',
        },
        data: {},
      };

      const request = {
        headers: { get: () => 'application/json' },
        json: async () => ({ exportData: invalidExport }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('Invalid export file format');
    });

    it('should return 400 for unsupported version', async () => {
      const invalidExport = {
        manifest: {
          format: 'quilltap-export',
          version: '2.0', // Unsupported version
        },
        data: {},
      };

      const request = {
        headers: { get: () => 'application/json' },
        json: async () => ({ exportData: invalidExport }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('Invalid export file format');
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================
  describe('Error Handling', () => {
    it('should return 500 when preview service throws', async () => {
      mockPreviewImport.mockRejectedValue(new Error('Preview failed'));

      const request = {
        headers: { get: () => 'application/json' },
        json: async () => ({ exportData: validExportData }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toContain('Preview failed');
    });
  });
});
