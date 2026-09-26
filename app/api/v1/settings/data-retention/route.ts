/**
 * Data Retention Settings Routes (v1)
 *
 * GET /api/v1/settings/data-retention - Read the instance-wide stale-chat retention window
 * PUT /api/v1/settings/data-retention - Update the retention window
 *
 * Instance-wide setting (`instance_settings['dataRetention']`), not a
 * `chat_settings` column — same class as the memory-recall knobs. Read daily
 * by the maintenance sweep (`lib/background-jobs/scheduled-maintenance.ts`)
 * to decide when a quiet chat's regenerable caches are collapsed.
 * Conversation-chunk embeddings are never cold-tiered and are unaffected by
 * this window.
 */

import { createInstanceSettingHandlers } from '@/lib/api/instance-setting-handlers';
import {
  getDataRetentionSettings,
  setDataRetentionSettings,
  DataRetentionSettingsSchema,
} from '@/lib/instance-settings';

export const { GET, PUT } = createInstanceSettingHandlers({
  label: 'data-retention',
  get: getDataRetentionSettings,
  set: setDataRetentionSettings,
  schema: DataRetentionSettingsSchema,
  logSummary: (settings) => ({ staleChatDays: settings.staleChatDays }),
});
