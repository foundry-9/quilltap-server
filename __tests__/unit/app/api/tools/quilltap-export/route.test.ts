/**
 * Unit tests for legacy Quilltap Export API routes
 * Tests that legacy routes return 410 Gone with redirect info
 *
 * Actual export functionality is now in /api/v1/system/tools?action=export*
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';

let GET: typeof import('@/app/api/tools/quilltap-export/route').GET;
let POST: typeof import('@/app/api/tools/quilltap-export/route').POST;

describe('Legacy Quilltap Export Routes (movedToV1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    jest.isolateModules(() => {
      const routesModule = require('@/app/api/tools/quilltap-export/route');
      GET = routesModule.GET;
      POST = routesModule.POST;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET /api/tools/quilltap-export', () => {
    it('should return 410 Gone with redirect to v1 preview endpoint', async () => {
      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(410);
      expect(body.error).toBe('Endpoint removed');
      expect(body.details.newEndpoint).toBe('/api/v1/system/tools?action=export-preview');
    });
  });

  describe('POST /api/tools/quilltap-export', () => {
    it('should return 410 Gone with redirect to v1 export endpoint', async () => {
      const response = await POST();
      const body = await response.json();

      expect(response.status).toBe(410);
      expect(body.error).toBe('Endpoint removed');
      expect(body.details.newEndpoint).toBe('/api/v1/system/tools?action=export');
    });
  });
});
