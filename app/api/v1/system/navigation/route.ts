/**
 * Navigation listing
 *
 * GET /api/v1/system/navigation — the navigation registry
 * (`lib/navigation/registry.ts`) as ids, labels and hrefs, for the Electron
 * shell's native menu bar. The shell builds one menu per group and sends a
 * clicked item's id back through `window.quilltap.onNavigate`.
 *
 * **Unauthenticated, like startup-status.** The listing is static: the same
 * table the rail renders, with no user data in it, and the shell may ask for
 * it before the instance is unlocked.
 *
 * Design of record: docs/developer/features/complete/navigation-menus.md.
 */

import { buildNavigationListing } from '@/lib/navigation/listing';
import { serverError, successResponse } from '@/lib/api/responses';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const listing = buildNavigationListing();
    logger.debug('[api.v1.system.navigation] Serving the navigation listing', {
      version: listing.version,
      groups: listing.groups.length,
    });
    return successResponse(listing);
  } catch (error) {
    logger.error('[api.v1.system.navigation] Failed to build the navigation listing', { error });
    return serverError('Failed to build the navigation listing');
  }
}
