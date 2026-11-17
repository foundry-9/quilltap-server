/**
 * Which pictures are fit to hang in a collage — the only place that is
 * judged (spec §5, `docs/developer/features/complete/dynamic-backgrounds.md`).
 *
 * With `allowUncensored` on, every picture is fit. Otherwise, per picture:
 *   1. bytes that carry an uncensored record anywhere (`findUncensoredImages`,
 *      the galleries' badge rule) → out;
 *   2. `generationModeration === 'moderated'` → in;
 *   3. unknown (`null`, every picture made before the column existed) → the
 *      guess: out when a chat it is linked to is Unmoderated now or was
 *      flagged by the danger classifier, otherwise in.
 *
 * A recorded value always outranks the guess. The guess is fallible in both
 * directions, and the help page says so.
 *
 * @module dynamic-backgrounds/eligibility
 */

import { logger } from '@/lib/logger';
import { findUncensoredImages, type UncensoredImagesRepos } from '@/lib/photos/uncensored-images';
import { getConciergeState } from '@/lib/services/dangerous-content/chat-override';
import type { ChatMetadata } from '@/lib/schemas/chat.types';
import type { DynamicBackgroundsSettings } from '@/lib/schemas/settings.types';
import type { FileEntry } from '@/lib/schemas/types';

const log = logger.child({ module: 'dynamic-backgrounds.eligibility' });

/** The slice of the repositories this needs. */
export interface EligibilityRepos extends UncensoredImagesRepos {
  chats: { findByIds(ids: string[]): Promise<ChatMetadata[]> };
}

/**
 * Whether a chat's posture taints the unknown pictures linked to it.
 *
 * DELIBERATE EXCEPTION to the standing rule that `isDangerousChat` is
 * classifier telemetry no routing or display decision reads: it is the only
 * evidence left about pictures made before `files.generationModeration`
 * existed, so this one function reads it, for `null` rows only. A grep-test
 * (`__tests__/unit/lib/dynamic-backgrounds/dangerous-chat-exception.test.ts`)
 * keeps the read here.
 */
function chatTaintsUnknownPictures(chat: ChatMetadata): boolean {
  return getConciergeState(chat) === 'unmoderated' || chat.isDangerousChat === true;
}

export async function filterForCollage(
  files: readonly FileEntry[],
  settings: Pick<DynamicBackgroundsSettings, 'allowUncensored'>,
  repos: EligibilityRepos,
): Promise<FileEntry[]> {
  if (settings.allowUncensored) {
    log.debug('Uncensored pictures allowed; every picture is fit', { count: files.length });
    return [...files];
  }

  const uncensored = await findUncensoredImages(repos, files.map((f) => f.sha256));

  const unknown = files.filter((f) => !uncensored.has(f.sha256) && f.generationModeration == null);
  const chatIds = Array.from(new Set(unknown.flatMap((f) => f.linkedTo ?? [])));
  const tainted = new Set<string>();
  if (chatIds.length > 0) {
    const chats = await repos.chats.findByIds(chatIds);
    for (const chat of chats) {
      if (chatTaintsUnknownPictures(chat)) tainted.add(chat.id);
    }
  }

  let byBytes = 0;
  let byGuess = 0;
  let byRecord = 0;
  const kept = files.filter((file) => {
    if (uncensored.has(file.sha256)) {
      byBytes += 1;
      return false;
    }
    if (file.generationModeration === 'moderated') return true;
    if (file.generationModeration != null) {
      // An uncensored record on this very row (its sha256 lookup failed soft).
      byRecord += 1;
      return false;
    }
    if ((file.linkedTo ?? []).some((id) => tainted.has(id))) {
      byGuess += 1;
      return false;
    }
    return true;
  });

  log.debug('Filtered collage pool', {
    before: files.length,
    after: kept.length,
    uncensoredByBytes: byBytes,
    uncensoredByRecord: byRecord,
    unknownLeftOutByGuess: byGuess,
    taintedChats: tainted.size,
  });
  return kept;
}
