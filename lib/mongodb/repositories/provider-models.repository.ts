/**
 * MongoDB Provider Models Repository
 *
 * Manages the global cache of available models per provider.
 * This is a system-wide collection, not user-scoped.
 */

import { MongoBaseRepository } from './base.repository';
import { ProviderModelSchema, type ProviderModel, type ModelType } from '@/lib/schemas/types';
import { logger } from '@/lib/logger';

export class ProviderModelsRepository extends MongoBaseRepository<ProviderModel> {
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
    try {
      const collection = await this.getCollection();
      const doc = await collection.findOne({ id });

      if (!doc) {
        return null;
      }

      const validated = this.validate(doc);
      return validated;
    } catch (error) {
      logger.error('Error finding provider model by ID', {
        modelId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find all provider models
   */
  async findAll(): Promise<ProviderModel[]> {
    try {
      const collection = await this.getCollection();
      const docs = await collection.find({}).toArray();
      const validated = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);
      return validated;
    } catch (error) {
      logger.error('Error finding all provider models', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Create a new provider model
   */
  async create(
    data: Omit<ProviderModel, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<ProviderModel> {
    try {
      const id = this.generateId();
      const now = this.getCurrentTimestamp();

      const model: ProviderModel = {
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      };

      const validated = this.validate(model);

      const collection = await this.getCollection();
      const result = await collection.insertOne(validated as any);

      logger.info('Provider model created successfully', {
        id,
        provider: data.provider,
        modelId: data.modelId,
        insertedId: result.insertedId.toString(),
      });

      return validated;
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
      const existing = await this.findById(id);
      if (!existing) {
        logger.warn('Provider model not found for update', { modelId: id });
        return null;
      }

      const now = this.getCurrentTimestamp();
      const updated: ProviderModel = {
        ...existing,
        ...data,
        id: existing.id, // Preserve ID
        createdAt: existing.createdAt, // Preserve creation timestamp
        updatedAt: now,
      };

      const validated = this.validate(updated);

      const collection = await this.getCollection();
      const result = await collection.updateOne(
        { id },
        { $set: validated as any }
      );

      logger.info('Provider model updated successfully', {
        modelId: id,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
      });

      return validated;
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
      const collection = await this.getCollection();
      const result = await collection.deleteOne({ id });

      if (result.deletedCount === 0) {
        logger.warn('Provider model not found for deletion', { modelId: id });
        return false;
      }

      logger.info('Provider model deleted successfully', {
        modelId: id,
        deletedCount: result.deletedCount,
      });

      return true;
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
      const collection = await this.getCollection();
      const query: Record<string, unknown> = { provider };
      if (modelType) {
        query.modelType = modelType;
      }
      const docs = await collection.find(query).toArray();
      const validated = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);
      return validated;
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
      const collection = await this.getCollection();
      const docs = await collection.find({ modelType }).toArray();
      const validated = docs
        .map((doc) => this.validateSafe(doc))
        .filter((result) => result.success)
        .map((result) => result.data!);
      return validated;
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
      const collection = await this.getCollection();
      const query: Record<string, unknown> = { provider, modelId, modelType };
      if (baseUrl) {
        query.baseUrl = baseUrl;
      }

      const doc = await collection.findOne(query);

      if (!doc) {
        return null;
      }

      const validated = this.validate(doc);
      return validated;
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
      // Check if model exists
      // Convert null to undefined for the baseUrl parameter
      const existing = await this.findByProviderAndModelId(
        data.provider,
        data.modelId,
        data.modelType ?? 'chat',
        data.baseUrl ?? undefined
      );

      if (existing) {
        const updated = await this.update(existing.id, data);
        if (!updated) {
          throw new Error('Failed to update existing provider model');
        }
        return updated;
      }

      // Create new model
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
      let created = 0;
      let updated = 0;

      for (const modelData of models) {
        try {
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

          // Check if it was created or updated
          const existing = await this.findByProviderAndModelId(
            provider,
            modelData.modelId,
            modelType,
            baseUrl
          );
          if (existing) {
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
      const collection = await this.getCollection();
      const query: Record<string, unknown> = { provider };
      if (modelType) {
        query.modelType = modelType;
      }
      if (baseUrl) {
        query.baseUrl = baseUrl;
      }

      const result = await collection.deleteMany(query);

      logger.info('Provider models deleted successfully', {
        provider,
        modelType,
        baseUrl,
        deletedCount: result.deletedCount,
      });

      return result.deletedCount;
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
