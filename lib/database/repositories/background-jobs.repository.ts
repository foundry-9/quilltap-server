/**
 * Background Jobs Repository
 *
 * Backend-agnostic repository for BackgroundJob entities.
 * Works with SQLite through the database abstraction layer.
 * Handles CRUD operations and queue-specific queries for BackgroundJob entities.
 * Provides atomic job claiming for concurrent-safe queue processing.
 */

import { BackgroundJob, BackgroundJobSchema, BackgroundJobType, BackgroundJobStatus } from '@/lib/schemas/types';
import { UserOwnedBaseRepository, CreateOptions } from './base.repository';
import { QueryFilter } from '../interfaces';
import { logger } from '@/lib/logger';

/**
 * Statistics about the job queue
 */
export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  dead: number;
  paused: number;
}

/**
 * Options for creating a job
 */
export interface CreateJobOptions {
  priority?: number;
  maxAttempts?: number;
  scheduledAt?: string;
}

/**
 * Background Jobs Repository
 * Implements CRUD operations and queue-specific methods for background jobs.
 */
export class BackgroundJobsRepository extends UserOwnedBaseRepository<BackgroundJob> {
  constructor() {
    super('background_jobs', BackgroundJobSchema);
  }

  /**
   * Find a job by ID
   */
  async findById(id: string): Promise<BackgroundJob | null> {
    return this._findById(id);
  }

  /**
   * Find all jobs (use with caution - primarily for admin/debugging)
   */
  async findAll(): Promise<BackgroundJob[]> {
    try {
      const collection = await this.getCollection();
      const results = await collection.find({}, { limit: 1000 });

      const jobs = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((job): job is BackgroundJob => job !== null);
      return jobs;
    } catch (error) {
      logger.error('Error finding all background jobs', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find jobs by user ID with optional status filter
   */
  async findByUserId(userId: string, status?: BackgroundJobStatus): Promise<BackgroundJob[]> {
    try {
      const query: QueryFilter = { userId };
      if (status) {
        query.status = status;
      }

      const results = await this.findByFilter(query, {
        sort: { createdAt: -1 as any },
        limit: 100,
      });
      return results;
    } catch (error) {
      logger.error('Error finding background jobs by user ID', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Find pending jobs for a specific chat
   */
  async findPendingForChat(chatId: string): Promise<BackgroundJob[]> {
    try {
      const results = await this.findByFilter(
        {
          'payload.chatId': chatId,
          status: { $in: ['PENDING', 'PROCESSING', 'FAILED'] },
        } as QueryFilter,
        {
          sort: { priority: -1 as any, createdAt: 1 as any },
        }
      );
      return results;
    } catch (error) {
      logger.error('Error finding pending jobs for chat', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Claim the next available job atomically
   * Uses findOneAndUpdate for concurrent-safe job claiming
   */
  async claimNextJob(): Promise<BackgroundJob | null> {
    try {
      const collection = await this.getCollection();
      const now = this.getCurrentTimestamp();

      const result = await collection.findOneAndUpdate(
        {
          status: { $in: ['PENDING', 'FAILED'] },
          scheduledAt: { $lte: now },
          $expr: { $lt: ['$attempts', '$maxAttempts'] },
        } as QueryFilter,
        {
          $set: {
            status: 'PROCESSING',
            startedAt: now,
            updatedAt: now,
          },
          $inc: { attempts: 1 },
        } as any,
        {
          returnDocument: 'after',
        }
      );

      if (!result) {
        return null;
      }

      const validated = this.validate(result);
      logger.info('Claimed job', { jobId: validated.id, type: validated.type, attempts: validated.attempts });
      return validated;
    } catch (error) {
      logger.error('Error claiming next job', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Create a new job
   */
  async create(
    data: Omit<BackgroundJob, 'id' | 'createdAt' | 'updatedAt'>,
    options?: CreateOptions
  ): Promise<BackgroundJob> {
    try {
      const job = await this._create(data, options);
      logger.info('Background job created', { jobId: job.id, type: data.type, userId: data.userId });
      return job;
    } catch (error) {
      logger.error('Error creating background job', {
        type: data.type,
        userId: data.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create multiple jobs in batch (for import)
   */
  async createBatch(
    jobs: Array<Omit<BackgroundJob, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<string[]> {
    try {
      if (jobs.length === 0) {
        return [];
      }

      const now = this.getCurrentTimestamp();
      const validatedJobs: BackgroundJob[] = [];
      const ids: string[] = [];

      for (const jobData of jobs) {
        const id = this.generateId();
        ids.push(id);

        const job: BackgroundJob = {
          ...jobData,
          id,
          createdAt: now,
          updatedAt: now,
        };

        validatedJobs.push(this.validate(job));
      }

      const collection = await this.getCollection();
      await collection.insertMany(validatedJobs);

      logger.info('Background jobs batch created', { count: validatedJobs.length });
      return ids;
    } catch (error) {
      logger.error('Error creating batch of background jobs', {
        count: jobs.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update a job
   */
  async update(id: string, data: Partial<BackgroundJob>): Promise<BackgroundJob | null> {
    try {
      const result = await this._update(id, data);
      return result;
    } catch (error) {
      logger.error('Error updating background job', {
        jobId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Mark a job as completed
   */
  async markCompleted(id: string, result?: Record<string, unknown>): Promise<BackgroundJob | null> {
    try {
      const collection = await this.getCollection();
      const now = this.getCurrentTimestamp();

      const updateData: any = {
        status: 'COMPLETED',
        completedAt: now,
        updatedAt: now,
      };

      if (result) {
        updateData['payload.result'] = result;
      }

      const updated = await collection.findOneAndUpdate(
        { id } as QueryFilter,
        { $set: updateData } as any,
        { returnDocument: 'after' }
      );

      if (!updated) {
        logger.warn('Background job not found for completion', { jobId: id });
        return null;
      }

      const validated = this.validate(updated);
      logger.info('Background job completed', { jobId: id, type: validated.type });
      return validated;
    } catch (error) {
      logger.error('Error marking job as completed', {
        jobId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Mark a job as failed with retry scheduling
   */
  async markFailed(id: string, errorMessage: string): Promise<BackgroundJob | null> {
    try {
      const collection = await this.getCollection();
      const now = this.getCurrentTimestamp();

      // First get the current job to check attempts
      const currentJob = await this.findById(id);
      if (!currentJob) {
        logger.warn('Background job not found for failure marking', { jobId: id });
        return null;
      }

      // Calculate next retry time with exponential backoff
      // 30s, 60s, 120s, 240s (capped at 5 minutes)
      const backoffSeconds = Math.min(30 * Math.pow(2, currentJob.attempts), 300);
      const scheduledAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();

      // Determine if we should mark as DEAD or FAILED for retry
      const newStatus = currentJob.attempts >= currentJob.maxAttempts ? 'DEAD' : 'FAILED';

      const updated = await collection.findOneAndUpdate(
        { id } as QueryFilter,
        {
          $set: {
            status: newStatus,
            lastError: errorMessage,
            scheduledAt,
            updatedAt: now,
          },
        } as any,
        { returnDocument: 'after' }
      );

      if (!updated) {
        return null;
      }

      const validated = this.validate(updated);

      if (newStatus === 'DEAD') {
        logger.warn('Background job marked as DEAD (max attempts reached)', {
          jobId: id,
          type: validated.type,
          attempts: validated.attempts,
          error: errorMessage,
        });
      } else {
        logger.info('Background job marked as FAILED (will retry)', {
          jobId: id,
          type: validated.type,
          attempts: validated.attempts,
          nextRetryAt: scheduledAt,
          error: errorMessage,
        });
      }

      return validated;
    } catch (error) {
      logger.error('Error marking job as failed', {
        jobId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete a job
   */
  async delete(id: string): Promise<boolean> {
    try {
      const result = await this._delete(id);
      return result;
    } catch (error) {
      logger.error('Error deleting background job', {
        jobId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get queue statistics
   */
  async getStats(userId?: string): Promise<QueueStats> {
    try {
      // Since the abstraction layer may not support full aggregation pipelines,
      // we fetch all items and aggregate in JavaScript
      const filter = userId ? ({ userId } as QueryFilter) : {};
      const jobs = await this.findByFilter(filter);

      const stats: QueueStats = {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        dead: 0,
        paused: 0,
      };

      for (const job of jobs) {
        switch (job.status) {
          case 'PENDING':
            stats.pending++;
            break;
          case 'PROCESSING':
            stats.processing++;
            break;
          case 'COMPLETED':
            stats.completed++;
            break;
          case 'FAILED':
            stats.failed++;
            break;
          case 'DEAD':
            stats.dead++;
            break;
          case 'PAUSED':
            stats.paused++;
            break;
        }
      }
      return stats;
    } catch (error) {
      logger.error('Error getting queue statistics', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { pending: 0, processing: 0, completed: 0, failed: 0, dead: 0, paused: 0 };
    }
  }

  /**
   * Cleanup old completed jobs
   */
  async cleanupOldJobs(olderThan: Date): Promise<number> {
    try {
      const deletedCount = await this.deleteMany({
        status: { $in: ['COMPLETED', 'DEAD'] },
        completedAt: { $lt: olderThan.toISOString() },
      } as QueryFilter);

      logger.info('Cleaned up old background jobs', { deletedCount });
      return deletedCount;
    } catch (error) {
      logger.error('Error cleaning up old jobs', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Cancel a pending job
   */
  async cancel(id: string): Promise<boolean> {
    try {
      const collection = await this.getCollection();
      const result = await collection.updateOne(
        { id, status: { $in: ['PENDING', 'FAILED'] } } as QueryFilter,
        {
          $set: {
            status: 'DEAD',
            lastError: 'Cancelled by user',
            updatedAt: this.getCurrentTimestamp(),
          },
        } as any
      );

      if (result.modifiedCount === 0) {
        logger.warn('Background job not found or not cancellable', { jobId: id });
        return false;
      }

      logger.info('Background job cancelled', { jobId: id });
      return true;
    } catch (error) {
      logger.error('Error cancelling background job', {
        jobId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Pause a pending or failed job
   */
  async pause(id: string): Promise<BackgroundJob | null> {
    try {
      const collection = await this.getCollection();
      const now = this.getCurrentTimestamp();

      const result = await collection.findOneAndUpdate(
        { id, status: { $in: ['PENDING', 'FAILED'] } } as QueryFilter,
        {
          $set: {
            status: 'PAUSED',
            updatedAt: now,
          },
        } as any,
        { returnDocument: 'after' }
      );

      if (!result) {
        logger.warn('Background job not found or not pausable', { jobId: id });
        return null;
      }

      const validated = this.validate(result);
      logger.info('Background job paused', { jobId: id, type: validated.type });
      return validated;
    } catch (error) {
      logger.error('Error pausing background job', {
        jobId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Resume a paused job
   */
  async resume(id: string): Promise<BackgroundJob | null> {
    try {
      const collection = await this.getCollection();
      const now = this.getCurrentTimestamp();

      const result = await collection.findOneAndUpdate(
        { id, status: 'PAUSED' } as QueryFilter,
        {
          $set: {
            status: 'PENDING',
            scheduledAt: now,
            updatedAt: now,
          },
        } as any,
        { returnDocument: 'after' }
      );

      if (!result) {
        logger.warn('Background job not found or not resumable', { jobId: id });
        return null;
      }

      const validated = this.validate(result);
      logger.info('Background job resumed', { jobId: id, type: validated.type });
      return validated;
    } catch (error) {
      logger.error('Error resuming background job', {
        jobId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Reset stuck processing jobs (for recovery after crash)
   * Jobs that have been processing for longer than timeout are reset to FAILED
   */
  async resetStuckJobs(timeoutMinutes: number = 10): Promise<number> {
    try {
      const collection = await this.getCollection();
      const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();
      const now = this.getCurrentTimestamp();

      const result = await collection.updateMany(
        {
          status: 'PROCESSING',
          startedAt: { $lt: cutoff },
        } as QueryFilter,
        {
          $set: {
            status: 'FAILED',
            lastError: `Timed out after ${timeoutMinutes} minutes`,
            updatedAt: now,
          },
        } as any
      );

      if (result.modifiedCount > 0) {
        logger.warn('Reset stuck processing jobs', { count: result.modifiedCount });
      }
      return result.modifiedCount;
    } catch (error) {
      logger.error('Error resetting stuck jobs', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }
}
