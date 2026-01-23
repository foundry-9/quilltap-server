/**
 * Integration tests for legacy prompts route
 * Tests that legacy route returns 410 Gone with redirect info
 *
 * Actual functionality is now in /api/v1/characters/[id]/prompts
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';

let GET: typeof import('@/app/api/characters/[id]/prompts/route').GET;
let POST: typeof import('@/app/api/characters/[id]/prompts/route').POST;

describe('Legacy Character Prompts Route (movedToV1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    jest.isolateModules(() => {
      const routesModule = require('@/app/api/characters/[id]/prompts/route');
      GET = routesModule.GET;
      POST = routesModule.POST;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET /api/characters/[id]/prompts', () => {
    it('should return 410 Gone with redirect to v1 endpoint', async () => {
      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(410);
      expect(body.error).toBe('Endpoint removed');
      expect(body.details.newEndpoint).toBe('/api/v1/characters/[id]/prompts');
    });
  });

  describe('POST /api/characters/[id]/prompts', () => {
    it('should return 410 Gone with redirect to v1 endpoint', async () => {
      const response = await POST();
      const body = await response.json();

      expect(response.status).toBe(410);
      expect(body.error).toBe('Endpoint removed');
      expect(body.details.newEndpoint).toBe('/api/v1/characters/[id]/prompts');
    });
  });
});
