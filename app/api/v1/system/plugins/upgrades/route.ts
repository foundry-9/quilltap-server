/**
 * Deprecated path — use `GET /api/v1/system/plugins?action=upgrades` and
 * `POST /api/v1/system/plugins?action=mark-upgrades-notified`. Answers for one
 * release (`lib/api/deprecated-path.ts`).
 */
import { deprecatedPath } from '@/lib/api/deprecated-path';
import { handleMarkUpgradesNotified, handlePluginUpgrades } from '../handlers';

export const dynamic = 'force-dynamic';

const OLD = '/api/v1/system/plugins/upgrades';
export const GET = deprecatedPath(OLD, '/api/v1/system/plugins?action=upgrades', handlePluginUpgrades);
export const POST = deprecatedPath(OLD, '/api/v1/system/plugins?action=mark-upgrades-notified', handleMarkUpgradesNotified);
