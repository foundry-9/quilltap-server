/**
 * GET /api/v1/system/directories?path=… — the subdirectories of a server-side
 * directory, for the Scriptorium's store-path picker. Formerly
 * `/api/v1/system/browse-directory` (a verb in the path), removed in 4.14.
 * Handler: `./handler.ts`.
 */
import { createContextHandler } from '@/lib/api/middleware';
import { handleListDirectory } from './handler';

export const GET = createContextHandler(handleListDirectory);
