/**
 * The one server-side reader of the dynamic-backgrounds settings.
 *
 * The row is the user's chat settings (single-user instance, read by the
 * request's user id — never "the first row"). A missing or malformed field
 * reads as the schema defaults, so a stale row can never switch the feature
 * on or let uncensored pictures in.
 *
 * @module dynamic-backgrounds/settings
 */

import { logger } from '@/lib/logger';
import {
  DEFAULT_DYNAMIC_BACKGROUNDS_SETTINGS,
  DynamicBackgroundsSettingsSchema,
  type DynamicBackgroundsSettings,
} from '@/lib/schemas/settings.types';
import type { ChatSettings } from '@/lib/schemas/types';

const log = logger.child({ module: 'dynamic-backgrounds.settings' });

/** The slice of the repositories this needs. */
export interface DynamicBackgroundSettingsRepos {
  chatSettings: { findByUserId(userId: string): Promise<ChatSettings | null> };
}

export async function resolveDynamicBackgroundSettings(
  repos: DynamicBackgroundSettingsRepos,
  userId: string,
): Promise<DynamicBackgroundsSettings> {
  const row = await repos.chatSettings.findByUserId(userId);
  const parsed = DynamicBackgroundsSettingsSchema.safeParse(row?.dynamicBackgrounds ?? {});
  if (!parsed.success) {
    log.warn('Stored dynamic-backgrounds settings did not parse; using the defaults', {
      issues: parsed.error.issues.length,
    });
    return { ...DEFAULT_DYNAMIC_BACKGROUNDS_SETTINGS };
  }
  log.debug('Resolved dynamic-backgrounds settings', { ...parsed.data });
  return parsed.data;
}
