/**
 * Unit tests for legacy Quilltap Import Preview API route
 * Tests that legacy routes return 410 Gone with redirect info
 *
 * Actual import functionality is now in /api/v1/system/tools?action=import*
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';

let POST: typeof import('@/app/api/tools/quilltap-import/route').POST;

describe('Legacy Quilltap Import Routes (movedToV1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    jest.isolateModules(() => {
      const routesModule = require('@/app/api/tools/quilltap-import/route');
      POST = routesModule.POST;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('POST /api/tools/quilltap-import', () => {
    it('should return 410 Gone with redirect to v1 import-preview endpoint', async () => {
      const response = await POST();
      const body = await response.json();

      expect(response.status).toBe(410);
      expect(body.error).toBe('Endpoint removed');
      expect(body.details.newEndpoint).toBe('/api/v1/system/tools?action=import-preview');
    });
  });
});
