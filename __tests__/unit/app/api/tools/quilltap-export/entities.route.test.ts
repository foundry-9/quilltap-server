/**
 * Unit tests for legacy Quilltap Export Entities API route
 * Tests that legacy routes return 410 Gone with redirect info
 *
 * Actual functionality is now in /api/v1/system/tools?action=export-entities
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';

let GET: typeof import('@/app/api/tools/quilltap-export/entities/route').GET;

describe('Legacy Quilltap Export Entities Route (movedToV1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    jest.isolateModules(() => {
      const routesModule = require('@/app/api/tools/quilltap-export/entities/route');
      GET = routesModule.GET;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET /api/tools/quilltap-export/entities', () => {
    it('should return 410 Gone with redirect to v1 export-entities endpoint', async () => {
      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(410);
      expect(body.error).toBe('Endpoint removed');
      expect(body.details.newEndpoint).toBe('/api/v1/system/tools?action=export-entities');
    });
  });
});
