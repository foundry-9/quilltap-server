/**
 * Unit tests for legacy Tasks Queue API route
 * Tests that legacy routes return 410 Gone with redirect info
 *
 * Actual functionality is now in /api/v1/system/tools?action=tasks-queue
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';

let GET: typeof import('@/app/api/tools/tasks-queue/route').GET;
let POST: typeof import('@/app/api/tools/tasks-queue/route').POST;

describe('Legacy Tasks Queue Route (movedToV1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    jest.isolateModules(() => {
      const routesModule = require('@/app/api/tools/tasks-queue/route');
      GET = routesModule.GET;
      POST = routesModule.POST;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('GET /api/tools/tasks-queue', () => {
    it('should return 410 Gone with redirect to v1 tasks-queue endpoint', async () => {
      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(410);
      expect(body.error).toBe('Endpoint removed');
      expect(body.details.newEndpoint).toBe('/api/v1/system/tools?action=tasks-queue');
    });
  });

  describe('POST /api/tools/tasks-queue', () => {
    it('should return 410 Gone with redirect to v1 tasks-queue endpoint', async () => {
      const response = await POST();
      const body = await response.json();

      expect(response.status).toBe(410);
      expect(body.error).toBe('Endpoint removed');
      expect(body.details.newEndpoint).toBe('/api/v1/system/tools?action=tasks-queue');
    });
  });
});
