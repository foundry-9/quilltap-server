/**
 * Whether an embedding profile can embed anything yet.
 *
 * A Built-in (TF-IDF) profile embeds nothing until its vocabulary has been
 * fitted from the instance's own memories, and a brand-new instance has none.
 * Help-doc sync and the mount scan used to queue every section and chunk
 * against that unfitted profile on first boot, and each job failed three times
 * on "not yet fitted" before going DEAD (about 150 of them per new install).
 * The first fit enqueues a full reindex, so nothing is lost by waiting.
 *
 * API-backed profiles are always ready here; whether their key works is the
 * call's business.
 */

import { logger } from '@/lib/logger';

interface ReadinessProfile {
  id: string;
  provider: string;
}

interface ReadinessRepos {
  tfidfVocabularies: { findByProfileId(profileId: string): Promise<unknown | null> };
}

export async function isEmbeddingProfileReady(
  profile: ReadinessProfile,
  repos: ReadinessRepos,
): Promise<boolean> {
  if (profile.provider !== 'BUILTIN') return true;
  const vocabulary = await repos.tfidfVocabularies.findByProfileId(profile.id);
  if (!vocabulary) {
    logger.debug('Built-in embedding profile has no fitted vocabulary yet', {
      context: 'embedding.profile-readiness',
      profileId: profile.id,
    });
    return false;
  }
  return true;
}
