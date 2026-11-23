/**
 * Register a freshly installed bundle with the running theme registry, so it
 * can be worn without a restart. The install routes (`/api/v1/themes`) and the
 * theme-draft install (`lib/themes/drafts/`) both call it.
 *
 * @module themes/hot-load
 */

import { logger } from '@/lib/logger';
import { publishRealtime } from '@/lib/realtime/bus';
import { loadInstalledBundles } from './bundle-loader';
import { themeRegistry } from './theme-registry';

/**
 * Load the installed bundle `themeId` and register it (replacing an earlier
 * registration of the same id), then tell open tabs the theme list changed.
 * Returns whether the bundle was found and registered.
 */
export async function hotLoadInstalledTheme(themeId: string | undefined): Promise<boolean> {
  if (!themeId) return false;
  const bundles = await loadInstalledBundles();
  const bundle = bundles.loaded.find((b) => b.manifest.id === themeId);
  if (bundle) {
    themeRegistry.registerBundleTheme(bundle);
    publishRealtime('themes', themeId);
  }
  logger.debug('Hot-loaded installed theme', { context: 'themes-hot-load', themeId, registered: !!bundle });
  return !!bundle;
}
