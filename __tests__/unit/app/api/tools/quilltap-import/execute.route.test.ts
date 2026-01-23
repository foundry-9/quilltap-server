/**
 * Unit tests for legacy Quilltap Import Execute API route
 * Tests that legacy routes return 410 Gone with redirect info
 *
 * Actual functionality is now in /api/v1/system/tools?action=import-execute
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';

let POST: typeof import('@/app/api/tools/quilltap-import/execute/route').POST;

describe('Legacy Quilltap Import Execute Route (movedToV1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    jest.isolateModules(() => {
      const routesModule = require('@/app/api/tools/quilltap-import/execute/route');
      POST = routesModule.POST;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('POST /api/tools/quilltap-import/execute', () => {
    it('should return 410 Gone with redirect to v1 import-execute endpoint', async () => {
      const response = await POST();
      const body = await response.json();

      expect(response.status).toBe(410);
      expect(body.error).toBe('Endpoint removed');
      expect(body.details.newEndpoint).toBe('/api/v1/system/tools?action=import-execute');
    });
  });
});
