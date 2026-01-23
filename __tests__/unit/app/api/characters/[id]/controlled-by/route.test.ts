/**
 * Unit tests for legacy controlled-by route
 * Tests that legacy route returns 410 Gone with redirect info
 *
 * Actual functionality is now in /api/v1/characters/[id]?action=toggle-controlled-by
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';

let PATCH: typeof import('@/app/api/characters/[id]/controlled-by/route').PATCH;

describe('Legacy Controlled-By Route (movedToV1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    jest.isolateModules(() => {
      const routesModule = require('@/app/api/characters/[id]/controlled-by/route');
      PATCH = routesModule.PATCH;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('PATCH /api/characters/[id]/controlled-by', () => {
    it('should return 410 Gone with redirect to v1 endpoint', async () => {
      const response = await PATCH();
      const body = await response.json();

      expect(response.status).toBe(410);
      expect(body.error).toBe('Endpoint removed');
      expect(body.details.newEndpoint).toBe('/api/v1/characters/[id]');
      expect(body.details.actionHint).toBe('action=toggle-controlled-by');
    });
  });
});
