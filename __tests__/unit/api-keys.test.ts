/**
 * Unit tests for legacy API Keys routes
 * Tests that legacy routes return 410 Gone with redirect info
 *
 * Actual functionality is now in /api/v1/api-keys
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';

let GET: typeof import('@/app/api/keys/route').GET;
let POST: typeof import('@/app/api/keys/route').POST;

describe('Legacy API Keys Routes (movedToV1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    jest.isolateModules(() => {
      const routesModule = require('@/app/api/keys/route');
      GET = routesModule.GET;
      POST = routesModule.POST;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET /api/keys', () => {
    it('should return 410 Gone with redirect to v1 api-keys endpoint', async () => {
      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(410);
      expect(body.error).toBe('Endpoint removed');
      expect(body.details.newEndpoint).toBe('/api/v1/api-keys');
    });
  });

  describe('POST /api/keys', () => {
    it('should return 410 Gone with redirect to v1 api-keys endpoint', async () => {
      const response = await POST();
      const body = await response.json();

      expect(response.status).toBe(410);
      expect(body.error).toBe('Endpoint removed');
      expect(body.details.newEndpoint).toBe('/api/v1/api-keys');
    });
  });
});
