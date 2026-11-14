/**
 * Deprecated path — use `GET /api/v1/groups?action=scenarios&characterIds=…`.
 * Answers for one release (`lib/api/deprecated-path.ts`).
 */
import { createContextHandler } from '@/lib/api/middleware';
import { deprecatedPath } from '@/lib/api/deprecated-path';
import { handleGroupScenarios } from '../actions/scenarios';

export const GET = createContextHandler(
  deprecatedPath('/api/v1/groups/scenarios', '/api/v1/groups?action=scenarios', handleGroupScenarios),
);
