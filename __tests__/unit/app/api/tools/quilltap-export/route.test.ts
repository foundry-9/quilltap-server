/**
 * Unit tests for Quilltap Export API routes
 * Tests: POST /api/tools/quilltap-export, GET /api/tools/quilltap-export (preview)
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { NextRequest } from 'next/server';
import { getServerSession } from '@/lib/auth/session';

// Mock next/server's NextResponse for unit tests
// The route uses `new NextResponse()` for file downloads with custom headers
class MockNextResponse {
  status: number;
  headers: Map<string, string>;
  private body: string;

  constructor(body: string, init?: { status?: number; headers?: Record<string, string> }) {
    this.body = body;
    this.status = init?.status ?? 200;
    this.headers = new Map(Object.entries(init?.headers ?? {}));
  }

  async json() {
    return JSON.parse(this.body);
  }

  static json(data: unknown, init?: { status?: number }) {
    return new MockNextResponse(JSON.stringify(data), init);
  }
}

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: MockNextResponse,
}));

// Mock dependencies
jest.mock('@/lib/auth/session', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('@/lib/export/quilltap-export-service', () => ({
  createExport: jest.fn(),
  previewExport: jest.fn(),
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
const exportServiceMock = jest.requireMock('@/lib/export/quilltap-export-service') as {
  createExport: jest.Mock;
  previewExport: jest.Mock;
};
const mockCreateExport = exportServiceMock.createExport;
const mockPreviewExport = exportServiceMock.previewExport;

let GET: typeof import('@/app/api/tools/quilltap-export/route').GET;
let POST: typeof import('@/app/api/tools/quilltap-export/route').POST;

describe('Quilltap Export API Route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateExport.mockReset();
    mockPreviewExport.mockReset();

    jest.isolateModules(() => {
      const routesModule = require('@/app/api/tools/quilltap-export/route');
      GET = routesModule.GET;
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

  // ============================================================================
  // POST /api/tools/quilltap-export (Create Export)
  // ============================================================================
  describe('POST /api/tools/quilltap-export', () => {
    const mockExportData = {
      manifest: {
        format: 'quilltap-export',
        version: '1.0',
        exportType: 'characters',
        exportedAt: '2024-01-01T00:00:00.000Z',
        counts: { characters: 2 },
      },
      data: {
        characters: [
          { id: 'char-1', name: 'Test Character' },
          { id: 'char-2', name: 'Another Character' },
        ],
      },
    };

    it('should create export and return file download', async () => {
      mockCreateExport.mockResolvedValue(mockExportData as any);

      const request = {
        json: async () => ({
          type: 'characters',
          scope: 'all',
          includeMemories: false,
        }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json');
      expect(response.headers.get('Content-Disposition')).toMatch(
        /^attachment; filename="quilltap-characters-\d{4}-\d{2}-\d{2}\.qtap"$/
      );
      expect(body.manifest.format).toBe('quilltap-export');
      expect(mockCreateExport).toHaveBeenCalledWith('user-123', {
        type: 'characters',
        scope: 'all',
        selectedIds: undefined,
        includeMemories: false,
      });
    });

    it('should handle selected IDs when scope is selected', async () => {
      mockCreateExport.mockResolvedValue(mockExportData as any);

      const request = {
        json: async () => ({
          type: 'characters',
          scope: 'selected',
          selectedIds: ['char-1', 'char-2'],
          includeMemories: true,
        }),
      } as unknown as NextRequest;

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockCreateExport).toHaveBeenCalledWith('user-123', {
        type: 'characters',
        scope: 'selected',
        selectedIds: ['char-1', 'char-2'],
        includeMemories: true,
      });
    });

    it('should return 401 when not authenticated', async () => {
      mockGetServerSession.mockResolvedValueOnce(null as any);

      const request = {
        json: async () => ({ type: 'characters', scope: 'all' }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body).toEqual({ error: 'Unauthorized' });
      expect(mockCreateExport).not.toHaveBeenCalled();
    });

    it('should return 401 when session has no user', async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: null } as any);

      const request = {
        json: async () => ({ type: 'characters', scope: 'all' }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body).toEqual({ error: 'Unauthorized' });
    });

    it('should handle export service errors', async () => {
      mockCreateExport.mockRejectedValue(new Error('Database connection failed'));

      const request = {
        json: async () => ({ type: 'characters', scope: 'all' }),
      } as unknown as NextRequest;

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toContain('Database connection failed');
    });

    it('should default scope to all when not provided', async () => {
      mockCreateExport.mockResolvedValue(mockExportData as any);

      const request = {
        json: async () => ({ type: 'personas' }),
      } as unknown as NextRequest;

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockCreateExport).toHaveBeenCalledWith('user-123', {
        type: 'personas',
        scope: 'all',
        selectedIds: undefined,
        includeMemories: false,
      });
    });

    it('should generate correct filename for different entity types', async () => {
      mockCreateExport.mockResolvedValue(mockExportData as any);

      const request = {
        json: async () => ({ type: 'roleplay-templates', scope: 'all' }),
      } as unknown as NextRequest;

      const response = await POST(request);

      expect(response.headers.get('Content-Disposition')).toMatch(
        /^attachment; filename="quilltap-roleplay-templates-\d{4}-\d{2}-\d{2}\.qtap"$/
      );
    });
  });

  // ============================================================================
  // GET /api/tools/quilltap-export (Preview Export)
  // ============================================================================
  describe('GET /api/tools/quilltap-export (Preview)', () => {
    const mockPreview = {
      entities: [
        { id: 'char-1', name: 'Character 1' },
        { id: 'char-2', name: 'Character 2' },
      ],
      warnings: [],
    };

    function createGetRequest(searchParams: Record<string, string>): NextRequest {
      const params = new URLSearchParams(searchParams);
      const url = `http://localhost:3000/api/tools/quilltap-export?${params.toString()}`;
      return { url } as unknown as NextRequest;
    }

    it('should return export preview', async () => {
      mockPreviewExport.mockResolvedValue(mockPreview as any);

      const request = createGetRequest({ type: 'characters', scope: 'all' });

      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.entities).toHaveLength(2);
      expect(mockPreviewExport).toHaveBeenCalledWith('user-123', {
        type: 'characters',
        scope: 'all',
        selectedIds: [],
        includeMemories: false,
      });
    });

    it('should parse selectedIds from comma-separated string', async () => {
      mockPreviewExport.mockResolvedValue(mockPreview as any);

      const request = createGetRequest({
        type: 'characters',
        scope: 'selected',
        selectedIds: 'char-1,char-2,char-3',
      });

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockPreviewExport).toHaveBeenCalledWith('user-123', {
        type: 'characters',
        scope: 'selected',
        selectedIds: ['char-1', 'char-2', 'char-3'],
        includeMemories: false,
      });
    });

    it('should parse includeMemories as boolean', async () => {
      mockPreviewExport.mockResolvedValue(mockPreview as any);

      const request = createGetRequest({
        type: 'characters',
        scope: 'all',
        includeMemories: 'true',
      });

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(mockPreviewExport).toHaveBeenCalledWith('user-123', {
        type: 'characters',
        scope: 'all',
        selectedIds: [],
        includeMemories: true,
      });
    });

    it('should return 401 when not authenticated', async () => {
      mockGetServerSession.mockResolvedValueOnce(null as any);

      const request = createGetRequest({ type: 'characters' });

      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body).toEqual({ error: 'Unauthorized' });
      expect(mockPreviewExport).not.toHaveBeenCalled();
    });

    it('should return 400 when type parameter is missing', async () => {
      const request = createGetRequest({ scope: 'all' });

      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('Missing required parameter: type');
    });

    it('should handle preview service errors', async () => {
      mockPreviewExport.mockRejectedValue(new Error('Preview generation failed'));

      const request = createGetRequest({ type: 'characters' });

      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toContain('Preview generation failed');
    });

    it('should filter empty strings from selectedIds', async () => {
      mockPreviewExport.mockResolvedValue(mockPreview as any);

      const request = createGetRequest({
        type: 'characters',
        selectedIds: 'char-1,,char-2,',
      });

      const response = await GET(request);

      expect(mockPreviewExport).toHaveBeenCalledWith('user-123', {
        type: 'characters',
        scope: 'all',
        selectedIds: ['char-1', 'char-2'],
        includeMemories: false,
      });
    });
  });
});
