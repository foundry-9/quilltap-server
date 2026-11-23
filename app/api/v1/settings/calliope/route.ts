/**
 * Calliope Settings Routes (v1)
 *
 * GET /api/v1/settings/calliope - Read Calliope's instance-wide settings
 * PUT /api/v1/settings/calliope - Update them
 *
 * Instance-wide setting (`instance_settings['calliope']`, Spec J decision 10):
 * the connection profile her conversations fall back to when none is pinned
 * (`connectionProfileId`; null = the default profile) and her agent-turn
 * budget. Read by `CALLIOPE_PERSONA` (`lib/services/calliope/persona.ts`).
 * PUT merges over the stored value.
 */

import { createInstanceSettingHandlers } from '@/lib/api/instance-setting-handlers';
import { getCalliopeSettings, setCalliopeSettings, CalliopeSettingsSchema } from '@/lib/instance-settings';

export const { GET, PUT } = createInstanceSettingHandlers({
  label: 'calliope',
  get: getCalliopeSettings,
  set: setCalliopeSettings,
  schema: CalliopeSettingsSchema,
  logSummary: (settings) => ({
    maxAgentTurns: settings.maxAgentTurns,
    connectionProfileId: settings.connectionProfileId ?? null,
  }),
});
