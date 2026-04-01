/**
 * Unit tests for legacy default-partner route
 * Tests that legacy route returns 410 Gone with redirect info
 *
 * Actual functionality is now in /api/v1/characters/[id]?action=default-partner and action=set-default-partner
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';

let GET: typeof import('@/app/api/characters/[id]/default-partner/route').GET;
let PUT: typeof import('@/app/api/characters/[id]/default-partner/route').PUT;

describe('Legacy Default Partner Route (movedToV1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    jest.isolateModules(() => {
      const routesModule = require('@/app/api/characters/[id]/default-partner/route');
      GET = routesModule.GET;
      PUT = routesModule.PUT;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET /api/characters/[id]/default-partner', () => {
    it('should return 410 Gone with redirect to v1 endpoint', async () => {
      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(410);
      expect(body.error).toBe('Endpoint removed');
      expect(body.details.newEndpoint).toBe('/api/v1/characters/[id]');
      expect(body.details.actionHint).toBe('action=default-partner');
    });
  });

  describe('PUT /api/characters/[id]/default-partner', () => {
    it('should return 410 Gone with redirect to v1 endpoint', async () => {
      const response = await PUT();
      const body = await response.json();

      expect(response.status).toBe(410);
      expect(body.error).toBe('Endpoint removed');
      expect(body.details.newEndpoint).toBe('/api/v1/characters/[id]');
      expect(body.details.actionHint).toBe('action=set-default-partner');
    });
  });
});
