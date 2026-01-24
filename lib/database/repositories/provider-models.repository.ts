/**
 * Provider Models Repository
 *
 * Backend-agnostic repository for Provider Model entities.
 * Works with both MongoDB and SQLite through the database abstraction layer.
 * Manages the global cache of available models per provider.
 * This is a system-wide collection, not user-scoped.
 */

import { logger } from '@/lib/logger';
import { ProviderModelSchema, type ProviderModel, type ModelType } from '@/lib/schemas/types';
import { AbstractBaseRepository, CreateOptions } from './base.repository';
import { QueryFilter } from '../interfaces';

/**
 * Provider Models Repository
 * Implements CRUD operations for provider models with custom filtering methods.
 */
export class ProviderModelsRepository extends AbstractBaseRepository<ProviderModel> {
  constructor() {
    super('provider_models', ProviderModelSchema);
  }

  // ============================================================================
  // REQUIRED ABSTRACT METHODS
  // ============================================================================

  /**
   * Find a provider model by ID
   */
  async findById(id: string): Promise<ProviderModel | null> {
    return this._findById(id);
  }

  /**
   * Find all provider models
   */
  async findAll(): Promise<ProviderModel[]> {
    return this._findAll();
  }

  /**
   * Create a new provider model
   */
  async create(
    data: Omit<ProviderModel, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<ProviderModel> {
    try {
      logger.debug('Creating new provider model', {
        provider: data.provider,
        modelId: data.modelId,
        collection: this.collectionName,
      });

      const model = await this._create(data, options);

      logger.info('Provider model created successfully', {
        id: model.id,
        provider: data.provider,
        modelId: data.modelId,
      });

      return model;
    } catch (error) {
      logger.error('Error creating provider model', {
        provider: data.provider,
        modelId: data.modelId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a provider model
   */
  async update(id: string, data: Partial<ProviderModel>): Promise<ProviderModel | null> {
    try {
      logger.debug('Updating provider model', {
        modelId: id,
        collection: this.collectionName,
      });

      const model = await this._update(id, data);

      if (model) {
        logger.info('Provider model updated successfully', { modelId: id });
      }

      return model;
    } catch (error) {
      logger.error('Error updating provider model', {
        modelId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a provider model
   */
  async delete(id: string): Promise<boolean> {
    try {
      logger.debug('Deleting provider model', {
        modelId: id,
        collection: this.collectionName,
      });

      const result = await this._delete(id);

      if (result) {
        logger.info('Provider model deleted successfully', { modelId: id });
      }

      return result;
    } catch (error) {
      logger.error('Error deleting provider model', {
        modelId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ============================================================================
  // CUSTOM METHODS
  // ============================================================================

  /**
   * Find all models for a specific provider (optionally filtered by model type)
   */
  async findByProvider(provider: string, modelType?: ModelType): Promise<ProviderModel[]> {
    try {
      logger.debug('Finding provider models by provider', {
        provider,
        modelType,
        collection: this.collectionName,
      });

      const query: Record<string, unknown> = { provider };
      if (modelType) {
        query.modelType = modelType;
      }

      const models = await this.findByFilter(query as QueryFilter);

      logger.debug('Provider models retrieved', {
        provider,
        modelType,
        count: models.length,
      });

      return models;
    } catch (error) {
      logger.error('Error finding provider models by provider', {
        provider,
        modelType,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find all models by model type (e.g., all chat models, all image models)
   */
  async findByModelType(modelType: ModelType): Promise<ProviderModel[]> {
    try {
      logger.debug('Finding provider models by model type', {
        modelType,
        collection: this.collectionName,
      });

      const models = await this.findByFilter({ modelType } as QueryFilter);

      logger.debug('Provider models retrieved for model type', {
        modelType,
        count: models.length,
      });

      return models;
    } catch (error) {
      logger.error('Error finding provider models by model type', {
        modelType,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find a specific model by provider, modelId, and model type
   */
  async findByProviderAndModelId(
    provider: string,
    modelId: string,
    modelType: ModelType = 'chat',
    baseUrl?: string
  ): Promise<ProviderModel | null> {
    try {
      logger.debug('Finding provider model by provider and modelId', {
        provider,
        modelId,
        modelType,
        baseUrl,
        collection: this.collectionName,
      });

      const query: Record<string, unknown> = { provider, modelId, modelType };
      if (baseUrl) {
        query.baseUrl = baseUrl;
      }

      const model = await this.findOneByFilter(query as QueryFilter);

      if (!model) {
        logger.debug('Provider model not found', { provider, modelId, modelType, baseUrl });
        return null;
      }

      logger.debug('Provider model found', { provider, modelId, modelType, baseUrl });
      return model;
    } catch (error) {
      logger.error('Error finding provider model by provider and modelId', {
        provider,
        modelId,
        modelType,
        baseUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Upsert a model (create or update based on provider + modelType + modelId + baseUrl)
   */
  async upsertModel(
    data: Omit<ProviderModel, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ProviderModel> {
    try {
      logger.debug('Upserting provider model', {
        provider: data.provider,
        modelId: data.modelId,
        modelType: data.modelType,
        baseUrl: data.baseUrl,
        collection: this.collectionName,
      });

      // Check if model exists
      // Convert null to undefined for the baseUrl parameter
      const existing = await this.findByProviderAndModelId(
        data.provider,
        data.modelId,
        data.modelType ?? 'chat',
        data.baseUrl ?? undefined
      );

      if (existing) {
        logger.debug('Provider model already exists, updating', {
          id: existing.id,
          provider: data.provider,
          modelId: data.modelId,
          modelType: data.modelType,
        });
        const updated = await this.update(existing.id, data);
        if (!updated) {
          throw new Error('Failed to update existing provider model');
        }
        return updated;
      }

      // Create new model
      logger.debug('Provider model does not exist, creating new', {
        provider: data.provider,
        modelId: data.modelId,
        modelType: data.modelType,
      });
      return await this.create(data);
    } catch (error) {
      logger.error('Error upserting provider model', {
        provider: data.provider,
        modelId: data.modelId,
        modelType: data.modelType,
        baseUrl: data.baseUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Bulk upsert models for a provider (used when fetching model list)
   */
  async upsertModelsForProvider(
    provider: string,
    models: Array<{
      modelId: string;
      displayName?: string;
      contextWindow?: number;
      maxOutputTokens?: number;
      deprecated?: boolean;
      experimental?: boolean;
    }>,
    modelType: ModelType = 'chat',
    baseUrl?: string
  ): Promise<{ created: number; updated: number }> {
    try {
      logger.debug('Bulk upserting models for provider', {
        provider,
        modelType,
        baseUrl,
        modelCount: models.length,
        collection: this.collectionName,
      });

      let created = 0;
      let updated = 0;

      for (const modelData of models) {
        try {
          const existingBefore = await this.findByProviderAndModelId(
            provider,
            modelData.modelId,
            modelType,
            baseUrl
          );

          await this.upsertModel({
            provider,
            modelId: modelData.modelId,
            modelType,
            displayName: modelData.displayName || modelData.modelId,
            baseUrl: baseUrl || null,
            contextWindow: modelData.contextWindow || null,
            maxOutputTokens: modelData.maxOutputTokens || null,
            deprecated: modelData.deprecated || false,
            experimental: modelData.experimental || false,
          });

          // Determine if it was created or updated
          if (existingBefore) {
            updated++;
          } else {
            created++;
          }
        } catch (modelError) {
          logger.warn('Failed to upsert individual model', {
            provider,
            modelId: modelData.modelId,
            modelType,
            error: modelError instanceof Error ? modelError.message : String(modelError),
          });
        }
      }

      logger.info('Bulk upsert completed for provider', {
        provider,
        modelType,
        baseUrl,
        totalModels: models.length,
        created,
        updated,
      });

      return { created, updated };
    } catch (error) {
      logger.error('Error bulk upserting models for provider', {
        provider,
        modelType,
        baseUrl,
        modelCount: models.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete all models for a provider (optionally filtered by model type)
   */
  async deleteByProvider(provider: string, modelType?: ModelType, baseUrl?: string): Promise<number> {
    try {
      logger.debug('Deleting all provider models for provider', {
        provider,
        modelType,
        baseUrl,
        collection: this.collectionName,
      });

      const query: Record<string, unknown> = { provider };
      if (modelType) {
        query.modelType = modelType;
      }
      if (baseUrl) {
        query.baseUrl = baseUrl;
      }

      const count = await this.deleteMany(query as QueryFilter);

      logger.info('Provider models deleted successfully', {
        provider,
        modelType,
        baseUrl,
        deletedCount: count,
      });

      return count;
    } catch (error) {
      logger.error('Error deleting provider models by provider', {
        provider,
        modelType,
        baseUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
