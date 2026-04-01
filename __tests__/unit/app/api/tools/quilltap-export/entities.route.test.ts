/**
 * Unit tests for Quilltap Export Entities API route
 * Tests: GET /api/tools/quilltap-export/entities
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

// Create mock user repos
const mockUserRepos = {
  characters: {
    findAll: jest.fn().mockResolvedValue([]),
  },
  personas: {
    findAll: jest.fn().mockResolvedValue([]),
  },
  chats: {
    findAll: jest.fn().mockResolvedValue([]),
  },
  tags: {
    findAll: jest.fn().mockResolvedValue([]),
  },
  memories: {
    findByCharacterId: jest.fn().mockResolvedValue([]),
  },
  connections: {
    findAll: jest.fn().mockResolvedValue([]),
  },
  imageProfiles: {
    findAll: jest.fn().mockResolvedValue([]),
  },
  embeddingProfiles: {
    findAll: jest.fn().mockResolvedValue([]),
  },
};

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(() => mockRepos),
  getUserRepositories: jest.fn(() => mockUserRepos),
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

let GET: typeof import('@/app/api/tools/quilltap-export/entities/route').GET;

describe('Quilltap Export Entities API Route', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    jest.isolateModules(() => {
      const routesModule = require('@/app/api/tools/quilltap-export/entities/route');
      GET = routesModule.GET;
    });

    // Setup auth mocks
    setupAuthMocks(mockGetServerSession, mockRepos);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createGetRequest(searchParams: Record<string, string>): NextRequest {
    const params = new URLSearchParams(searchParams);
    const url = `http://localhost:3000/api/tools/quilltap-export/entities?${params.toString()}`;
    return { url } as unknown as NextRequest;
  }

  // ============================================================================
  // Authentication Tests
  // ============================================================================
  describe('Authentication', () => {
    it('should return 401 when not authenticated', async () => {
      mockGetServerSession.mockResolvedValueOnce(null as any);

      const request = createGetRequest({ type: 'characters' });
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body).toEqual({ error: 'Unauthorized' });
    });

    it('should return 401 when session has no user', async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: null } as any);

      const request = createGetRequest({ type: 'characters' });
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body).toEqual({ error: 'Unauthorized' });
    });
  });

  // ============================================================================
  // Parameter Validation Tests
  // ============================================================================
  describe('Parameter Validation', () => {
    it('should return 400 when type parameter is missing', async () => {
      const request = createGetRequest({});
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body).toEqual({ error: 'Missing type parameter' });
    });

    it('should return 400 for unknown entity type', async () => {
      const request = createGetRequest({ type: 'invalid-type' });
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain('Unknown entity type');
    });
  });

  // ============================================================================
  // Characters Entity Tests
  // ============================================================================
  describe('Characters Entities', () => {
    it('should return characters with memory counts', async () => {
      const characters = [
        { id: 'char-1', name: 'Character 1' },
        { id: 'char-2', name: 'Character 2' },
      ];
      const memoriesChar1 = [
        { id: 'mem-1', characterId: 'char-1' },
        { id: 'mem-2', characterId: 'char-1' },
      ];
      const memoriesChar2 = [{ id: 'mem-3', characterId: 'char-2' }];

      mockUserRepos.characters.findAll.mockResolvedValue(characters as any);
      mockUserRepos.memories.findByCharacterId
        .mockResolvedValueOnce(memoriesChar1 as any)
        .mockResolvedValueOnce(memoriesChar2 as any);

      const request = createGetRequest({ type: 'characters' });
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.entities).toHaveLength(2);
      expect(body.entities[0]).toEqual({ id: 'char-1', name: 'Character 1', memoryCount: 2 });
      expect(body.entities[1]).toEqual({ id: 'char-2', name: 'Character 2', memoryCount: 1 });
      expect(body.memoryCount).toBe(3);
    });

    it('should return empty array when no characters exist', async () => {
      mockUserRepos.characters.findAll.mockResolvedValue([]);

      const request = createGetRequest({ type: 'characters' });
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.entities).toHaveLength(0);
      expect(body.memoryCount).toBe(0);
    });
  });

  // ============================================================================
  // Personas Entity Tests
  // ============================================================================
  describe('Personas Entities', () => {
    it('should return personas with memory counts', async () => {
      const personas = [
        { id: 'persona-1', name: 'Persona 1' },
        { id: 'persona-2', name: 'Persona 2' },
      ];
      const characters = [{ id: 'char-1', name: 'Char' }];
      const memories = [
        { id: 'mem-1', personaId: 'persona-1' },
        { id: 'mem-2', personaId: 'persona-1' },
        { id: 'mem-3', personaId: 'persona-2' },
      ];

      mockUserRepos.personas.findAll.mockResolvedValue(personas as any);
      mockUserRepos.characters.findAll.mockResolvedValue(characters as any);
      mockUserRepos.memories.findByCharacterId.mockResolvedValue(memories as any);

      const request = createGetRequest({ type: 'personas' });
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.entities).toHaveLength(2);
      expect(body.entities[0]).toEqual({ id: 'persona-1', name: 'Persona 1', memoryCount: 2 });
      expect(body.entities[1]).toEqual({ id: 'persona-2', name: 'Persona 2', memoryCount: 1 });
    });
  });

  // ============================================================================
  // Chats Entity Tests
  // ============================================================================
  describe('Chats Entities', () => {
    it('should return chats with memory counts using title', async () => {
      const chats = [
        { id: 'chat-1', title: 'Chat Title 1' },
        { id: 'chat-2', title: 'Chat Title 2' },
      ];
      const characters = [{ id: 'char-1', name: 'Char' }];
      const memories = [
        { id: 'mem-1', chatId: 'chat-1' },
        { id: 'mem-2', chatId: 'chat-2' },
        { id: 'mem-3', chatId: 'chat-2' },
      ];

      mockUserRepos.chats.findAll.mockResolvedValue(chats as any);
      mockUserRepos.characters.findAll.mockResolvedValue(characters as any);
      mockUserRepos.memories.findByCharacterId.mockResolvedValue(memories as any);

      const request = createGetRequest({ type: 'chats' });
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.entities).toHaveLength(2);
      expect(body.entities[0]).toEqual({ id: 'chat-1', name: 'Chat Title 1', memoryCount: 1 });
      expect(body.entities[1]).toEqual({ id: 'chat-2', name: 'Chat Title 2', memoryCount: 2 });
    });
  });

  // ============================================================================
  // Tags Entity Tests
  // ============================================================================
  describe('Tags Entities', () => {
    it('should return all tags', async () => {
      const tags = [
        { id: 'tag-1', name: 'Tag 1' },
        { id: 'tag-2', name: 'Tag 2' },
      ];

      mockUserRepos.tags.findAll.mockResolvedValue(tags as any);

      const request = createGetRequest({ type: 'tags' });
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.entities).toHaveLength(2);
      expect(body.entities[0]).toEqual({ id: 'tag-1', name: 'Tag 1' });
      expect(body.memoryCount).toBe(0);
    });
  });

  // ============================================================================
  // Connection Profiles Entity Tests
  // ============================================================================
  describe('Connection Profiles Entities', () => {
    it('should return all connection profiles', async () => {
      const profiles = [
        { id: 'conn-1', name: 'Connection 1' },
        { id: 'conn-2', name: 'Connection 2' },
      ];

      mockUserRepos.connections.findAll.mockResolvedValue(profiles as any);

      const request = createGetRequest({ type: 'connection-profiles' });
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.entities).toHaveLength(2);
      expect(body.entities[0]).toEqual({ id: 'conn-1', name: 'Connection 1' });
    });
  });

  // ============================================================================
  // Image Profiles Entity Tests
  // ============================================================================
  describe('Image Profiles Entities', () => {
    it('should return all image profiles', async () => {
      const profiles = [
        { id: 'img-1', name: 'Image Profile 1' },
        { id: 'img-2', name: 'Image Profile 2' },
      ];

      mockUserRepos.imageProfiles.findAll.mockResolvedValue(profiles as any);

      const request = createGetRequest({ type: 'image-profiles' });
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.entities).toHaveLength(2);
      expect(body.entities[0]).toEqual({ id: 'img-1', name: 'Image Profile 1' });
    });
  });

  // ============================================================================
  // Embedding Profiles Entity Tests
  // ============================================================================
  describe('Embedding Profiles Entities', () => {
    it('should return all embedding profiles', async () => {
      const profiles = [
        { id: 'emb-1', name: 'Embedding Profile 1' },
        { id: 'emb-2', name: 'Embedding Profile 2' },
      ];

      mockUserRepos.embeddingProfiles.findAll.mockResolvedValue(profiles as any);

      const request = createGetRequest({ type: 'embedding-profiles' });
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.entities).toHaveLength(2);
      expect(body.entities[0]).toEqual({ id: 'emb-1', name: 'Embedding Profile 1' });
    });
  });

  // ============================================================================
  // Roleplay Templates Entity Tests
  // ============================================================================
  describe('Roleplay Templates Entities', () => {
    it('should return only user-created roleplay templates', async () => {
      const templates = [
        { id: 'rt-1', name: 'User Template', isBuiltIn: false, pluginName: null, userId: 'user-123' },
        { id: 'rt-2', name: 'Built-in Template', isBuiltIn: true, pluginName: null, userId: null },
        { id: 'rt-3', name: 'Plugin Template', isBuiltIn: false, pluginName: 'some-plugin', userId: null },
        { id: 'rt-4', name: 'Other User Template', isBuiltIn: false, pluginName: null, userId: 'other-user' },
      ];

      mockRepos.roleplayTemplates.findAll.mockResolvedValue(templates as any);

      const request = createGetRequest({ type: 'roleplay-templates' });
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.entities).toHaveLength(1);
      expect(body.entities[0]).toEqual({ id: 'rt-1', name: 'User Template' });
    });

    it('should return empty when no user-created templates exist', async () => {
      const templates = [
        { id: 'rt-1', name: 'Built-in Template', isBuiltIn: true, pluginName: null, userId: null },
      ];

      mockRepos.roleplayTemplates.findAll.mockResolvedValue(templates as any);

      const request = createGetRequest({ type: 'roleplay-templates' });
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.entities).toHaveLength(0);
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================
  describe('Error Handling', () => {
    it('should return 500 when repository throws error', async () => {
      mockUserRepos.characters.findAll.mockRejectedValue(new Error('Database error'));

      const request = createGetRequest({ type: 'characters' });
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({ error: 'Failed to fetch entities' });
    });
  });
});
