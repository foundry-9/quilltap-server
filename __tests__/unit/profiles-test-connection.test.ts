/**
 * Unit tests for legacy test-connection route
 * Tests that legacy route returns 410 Gone with redirect info
 *
 * Actual functionality is now in /api/v1/connection-profiles?action=test-connection
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';

let POST: typeof import('@/app/api/profiles/test-connection/route').POST;

describe('Legacy Test Connection Route (movedToV1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    jest.isolateModules(() => {
      const routesModule = require('@/app/api/profiles/test-connection/route');
      POST = routesModule.POST;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('POST /api/profiles/test-connection', () => {
    it('should return 410 Gone with redirect to v1 test-connection endpoint', async () => {
      const response = await POST();
      const body = await response.json();

      expect(response.status).toBe(410);
      expect(body.error).toBe('Endpoint removed');
      expect(body.details.newEndpoint).toBe('/api/v1/connection-profiles');
      expect(body.details.actionHint).toBe('action=test-connection');
    });
  });
});
