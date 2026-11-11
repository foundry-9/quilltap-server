/**
 * Deprecated path — use `GET /api/v1/system/directories?path=…`. Answers for
 * one release (`lib/api/deprecated-path.ts`).
 */
import { createContextHandler } from '@/lib/api/middleware';
import { deprecatedPath } from '@/lib/api/deprecated-path';
import { handleListDirectory } from '../directories/handler';

export const GET = createContextHandler(
  deprecatedPath('/api/v1/system/browse-directory', '/api/v1/system/directories', handleListDirectory),
);
