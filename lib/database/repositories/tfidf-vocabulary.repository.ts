/**
 * TF-IDF Vocabulary Repository
 *
 * Repository for managing TF-IDF vocabulary records used by the
 * built-in embedding provider. Each BUILTIN embedding profile has
 * one vocabulary record that stores the fitted vocabulary, IDF weights,
 * and statistics.
 */

import { logger } from '@/lib/logger';
import { TfidfVocabulary, TfidfVocabularySchema } from '@/lib/schemas/types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { QueryFilter } from '../interfaces';

/**
 * TF-IDF Vocabulary Repository
 *
 * Manages vocabulary storage for the built-in TF-IDF embedding provider.
 */
export class TfidfVocabularyRepository extends AbstractBaseRepository<TfidfVocabulary> {
  constructor() {
    super('tfidf_vocabularies', TfidfVocabularySchema);
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Find a vocabulary by ID
   */
  async findById(id: string): Promise<TfidfVocabulary | null> {
    try {
      const collection = await this.getCollection();
      const result = await collection.findOne({ id } as QueryFilter);
      return result;
    } catch (error) {
      logger.error('Error finding TF-IDF vocabulary by ID', {
        context: 'TfidfVocabularyRepository.findById',
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find all vocabularies
   */
  async findAll(): Promise<TfidfVocabulary[]> {
    try {
      const collection = await this.getCollection();
      return await collection.find({});
    } catch (error) {
      logger.error('Error finding all TF-IDF vocabularies', {
        context: 'TfidfVocabularyRepository.findAll',
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find vocabulary by embedding profile ID
   */
  async findByProfileId(profileId: string): Promise<TfidfVocabulary | null> {
    try {
      const collection = await this.getCollection();
      const result = await collection.findOne({ profileId } as QueryFilter);
      return result;
    } catch (error) {
      logger.error('Error finding TF-IDF vocabulary by profile ID', {
        context: 'TfidfVocabularyRepository.findByProfileId',
        profileId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find vocabulary by user ID
   */
  async findByUserId(userId: string): Promise<TfidfVocabulary[]> {
    try {
      const collection = await this.getCollection();
      return await collection.find({ userId } as QueryFilter);
    } catch (error) {
      logger.error('Error finding TF-IDF vocabularies by user ID', {
        context: 'TfidfVocabularyRepository.findByUserId',
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Create a new vocabulary record
   */
  async create(
    data: Omit<TfidfVocabulary, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<TfidfVocabulary> {
    try {
      const collection = await this.getCollection();
      const now = this.getCurrentTimestamp();

      const vocabulary: TfidfVocabulary = {
        id: options?.id || this.generateId(),
        ...data,
        createdAt: options?.createdAt || now,
        updatedAt: now,
      };

      const validated = this.validate(vocabulary);
      await collection.insertOne(validated);

      logger.info('TF-IDF vocabulary created', {
        context: 'TfidfVocabularyRepository.create',
        id: validated.id,
        profileId: data.profileId,
        userId: data.userId,
        vocabularySize: data.vocabularySize,
      });

      return validated;
    } catch (error) {
      logger.error('Error creating TF-IDF vocabulary', {
        context: 'TfidfVocabularyRepository.create',
        profileId: data.profileId,
        userId: data.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a vocabulary record
   */
  async update(id: string, data: Partial<TfidfVocabulary>): Promise<TfidfVocabulary | null> {
    try {
      const collection = await this.getCollection();
      const now = this.getCurrentTimestamp();

      // Remove immutable fields
      const updateData = { ...data };
      delete updateData.id;
      delete updateData.createdAt;

      const result = await collection.updateOne(
        { id } as QueryFilter,
        { $set: { ...updateData, updatedAt: now } }
      );

      if (result.modifiedCount === 0) {
        return null;
      }

      logger.info('TF-IDF vocabulary updated', {
        context: 'TfidfVocabularyRepository.update',
        id,
        updatedFields: Object.keys(updateData),
      });

      return this.findById(id);
    } catch (error) {
      logger.error('Error updating TF-IDF vocabulary', {
        context: 'TfidfVocabularyRepository.update',
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Upsert a vocabulary record (create or update by profile ID)
   */
  async upsertByProfileId(
    profileId: string,
    data: Omit<TfidfVocabulary, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<TfidfVocabulary> {
    const existing = await this.findByProfileId(profileId);

    if (existing) {
      const updated = await this.update(existing.id, data);
      if (!updated) {
        throw new Error(`Failed to update vocabulary for profile ${profileId}`);
      }
      return updated;
    }

    return this.create(data);
  }

  /**
   * Delete a vocabulary record
   */
  async delete(id: string): Promise<boolean> {
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteOne({ id } as QueryFilter);

      if (result.deletedCount > 0) {
        logger.info('TF-IDF vocabulary deleted', {
          context: 'TfidfVocabularyRepository.delete',
          id,
        });
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error deleting TF-IDF vocabulary', {
        context: 'TfidfVocabularyRepository.delete',
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete vocabulary by profile ID
   */
  async deleteByProfileId(profileId: string): Promise<boolean> {
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteMany({ profileId } as QueryFilter);

      if (result.deletedCount > 0) {
        logger.info('TF-IDF vocabulary deleted by profile ID', {
          context: 'TfidfVocabularyRepository.deleteByProfileId',
          profileId,
          deletedCount: result.deletedCount,
        });
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error deleting TF-IDF vocabulary by profile ID', {
        context: 'TfidfVocabularyRepository.deleteByProfileId',
        profileId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
