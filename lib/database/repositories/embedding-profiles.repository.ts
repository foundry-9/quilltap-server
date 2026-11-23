/**
 * Embedding Profiles Repository
 *
 * Backend-agnostic repository for EmbeddingProfile entities.
 * Works with SQLite through the database abstraction layer.
 */

import { EmbeddingProfile, EmbeddingProfileSchema } from '@/lib/schemas/types';
import { DefaultableProfileRepository } from './defaultable-profile.repository';

/**
 * Embedding Profiles Repository
 * CRUD for embedding profiles with user-scoping, tag support and
 * default-profile management, inherited from
 * {@link DefaultableProfileRepository}. Its finders answer null when the read
 * itself fails, where the image-profile finders rethrow.
 */
export class EmbeddingProfilesRepository extends DefaultableProfileRepository<EmbeddingProfile> {
  constructor() {
    super('embedding_profiles', EmbeddingProfileSchema, { noun: 'embedding profile', onFinderFailure: 'null' });
  }

  /**
   * Find the instance's default embedding profile, whoever owns it — for
   * instance-level passes (boot, scheduled maintenance) that have no user in
   * hand. Single-user instances hold one default.
   */
  async findInstanceDefault(): Promise<EmbeddingProfile | null> {
    return this.safeQuery(
      async () => (await this.findOneByFilter({ isDefault: true })) ?? null,
      'Error finding the instance default embedding profile',
      {},
      null
    );
  }
}
