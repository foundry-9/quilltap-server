/**
 * Deprecated path — use `POST /api/v1/inventory?action=move-to-tier` or
 * `?action=copy-to-tier` (the body without `action`). This path still takes
 * `action` in the body, for one release (`lib/api/deprecated-path.ts`).
 */
import { createContextHandler } from '@/lib/api/middleware';
import { deprecatedPath } from '@/lib/api/deprecated-path';
import { handleInventoryTransfer } from '@/lib/inventory/routes/transfer';

export const POST = createContextHandler(
  deprecatedPath('/api/v1/inventory/transfers', '/api/v1/inventory?action=move-to-tier', handleInventoryTransfer('from-body')),
);
