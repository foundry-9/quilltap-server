/**
 * System Plugins API v1
 *
 * GET  /api/v1/system/plugins?action=state                  - plugin system state
 * GET  /api/v1/system/plugins?action=upgrades               - un-notified plugin upgrades
 * POST /api/v1/system/plugins?action=initialize             - initialize the plugin system
 * POST /api/v1/system/plugins?action=mark-upgrades-notified - the upgrades have been shown
 *
 * All four answer during startup — the root layout's plugin initializer can
 * fire on the unlock screen, before any database is open — so none runs under
 * `createContextHandler`, which waits for startup and builds a user context
 * from the database. Handlers: `./handlers.ts`.
 */

import type { NextRequest } from 'next/server';
import { dispatchAction } from '@/lib/api/middleware/actions';
import {
  handleInitializePlugins,
  handleMarkUpgradesNotified,
  handlePluginSystemState,
  handlePluginUpgrades,
} from './handlers';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return dispatchAction(req, {
    state: () => handlePluginSystemState(),
    upgrades: () => handlePluginUpgrades(),
  });
}

export async function POST(req: NextRequest) {
  return dispatchAction(req, {
    initialize: () => handleInitializePlugins(),
    'mark-upgrades-notified': () => handleMarkUpgradesNotified(),
  });
}
