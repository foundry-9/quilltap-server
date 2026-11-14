/**
 * Deprecated path — use `POST /api/v1/atlas?action=move-to-tier` or
 * `?action=copy-to-tier` (the body without `action`). This path still takes
 * `action` in the body, for one release (`lib/api/deprecated-path.ts`).
 */
import { createContextHandler } from '@/lib/api/middleware';
import { deprecatedPath } from '@/lib/api/deprecated-path';
import { handleAtlasTransfer } from '@/lib/atlas/routes/transfer';

export const POST = createContextHandler(
  deprecatedPath('/api/v1/atlas/transfers', '/api/v1/atlas?action=move-to-tier', handleAtlasTransfer('from-body')),
);
