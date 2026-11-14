/**
 * Deprecated path — use `POST /api/v1/system/plugins?action=initialize` and
 * `GET /api/v1/system/plugins?action=state`. Answers for one release
 * (`lib/api/deprecated-path.ts`).
 */
import { deprecatedPath } from '@/lib/api/deprecated-path';
import { handleInitializePlugins, handlePluginSystemState } from '../handlers';

export const dynamic = 'force-dynamic';

const OLD = '/api/v1/system/plugins/initialize';
export const POST = deprecatedPath(OLD, '/api/v1/system/plugins?action=initialize', handleInitializePlugins);
export const GET = deprecatedPath(OLD, '/api/v1/system/plugins?action=state', handlePluginSystemState);
