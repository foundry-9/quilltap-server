/**
 * Resolver for the "alert characters of Lantern images" setting.
 *
 * Walks the chat -> project -> global fallback chain; a null/undefined value
 * at the inner layer means "inherit from outer layer". Global default is OFF.
 */

import type { ChatMetadata, Project } from '@/lib/schemas/types';

export function isLanternImageAlertEnabled(
  chat: Pick<ChatMetadata, 'alertCharactersOfLanternImages'> | null | undefined,
  project: Pick<Project, 'defaultAlertCharactersOfLanternImages'> | null | undefined
): boolean {
  if (chat?.alertCharactersOfLanternImages != null) {
    return chat.alertCharactersOfLanternImages;
  }
  if (project?.defaultAlertCharactersOfLanternImages != null) {
    return project.defaultAlertCharactersOfLanternImages;
  }
  return false;
}
