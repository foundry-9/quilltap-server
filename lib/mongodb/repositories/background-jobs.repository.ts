/**
 * MongoDB Background Jobs Repository
 *
 * Handles CRUD operations and queue-specific queries for BackgroundJob entities.
 * Provides atomic job claiming for concurrent-safe queue processing.
 */

import { BackgroundJob, BackgroundJobSchema, BackgroundJobType, BackgroundJobStatus } from '@/lib/schemas/types';
import { MongoBaseRepository } from './base.repository';
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

export class BackgroundJobsRepository extends MongoBaseRepository<BackgroundJob> {
  constructor() {
    super('background_jobs', BackgroundJobSchema);
    logger.debug('BackgroundJobsRepository initialized');
  }

  /**
   * Find a job by ID
   */
  async findById(id: string): Promise<BackgroundJob | null> {
    logger.debug('Finding background job by ID', { jobId: id });
    try {
      const collection = await this.getCollection();
      const result = await collection.findOne({ id });

      if (!result) {
        logger.debug('Background job not found', { jobId: id });
        return null;
      }

      const validated = this.validate(result);
      logger.debug('Background job found and validated', { jobId: id });
      return validated;
    } catch (error) {
      logger.error('Error finding background job by ID', {
        jobId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Find all jobs (use with caution - primarily for admin/debugging)
   */
  async findAll(): Promise<BackgroundJob[]> {
    logger.debug('Finding all background jobs');
    try {
      const collection = await this.getCollection();
      const results = await collection.find({}).limit(1000).toArray();

      const jobs = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((job): job is BackgroundJob => job !== null);

      logger.debug('Retrieved background jobs', { count: jobs.length });
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
    logger.debug('Finding background jobs by user ID', { userId, status });
    try {
      const collection = await this.getCollection();
      const query: Record<string, unknown> = { userId };
      if (status) {
        query.status = status;
      }

      const results = await collection.find(query).sort({ createdAt: -1 }).limit(100).toArray();

      const jobs = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((job): job is BackgroundJob => job !== null);

      logger.debug('Found background jobs for user', { userId, count: jobs.length });
      return jobs;
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
    logger.debug('Finding pending jobs for chat', { chatId });
    try {
      const collection = await this.getCollection();
      const results = await collection
        .find({
          'payload.chatId': chatId,
          status: { $in: ['PENDING', 'PROCESSING', 'FAILED'] },
        })
        .sort({ priority: -1, createdAt: 1 })
        .toArray();

      const jobs = results
        .map((doc) => {
          const validation = this.validateSafe(doc);
          if (validation.success && validation.data) {
            return validation.data;
          }
          return null;
        })
        .filter((job): job is BackgroundJob => job !== null);

      logger.debug('Found pending jobs for chat', { chatId, count: jobs.length });
      return jobs;
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
    logger.debug('Attempting to claim next job');
    try {
      const collection = await this.getCollection();
      const now = this.getCurrentTimestamp();

      const result = await collection.findOneAndUpdate(
        {
          status: { $in: ['PENDING', 'FAILED'] },
          scheduledAt: { $lte: now },
          $expr: { $lt: ['$attempts', '$maxAttempts'] },
        },
        {
          $set: {
            status: 'PROCESSING',
            startedAt: now,
            updatedAt: now,
          },
          $inc: { attempts: 1 },
        },
        {
          sort: { priority: -1, scheduledAt: 1 },
          returnDocument: 'after',
        }
      );

      if (!result) {
        logger.debug('No jobs available to claim');
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
    data: Omit<BackgroundJob, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<BackgroundJob> {
    logger.debug('Creating background job', { type: data.type, userId: data.userId });
    try {
      const id = this.generateId();
      const now = this.getCurrentTimestamp();

      const job: BackgroundJob = {
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      };

      const validated = this.validate(job);
      const collection = await this.getCollection();
      await collection.insertOne(validated as any);

      logger.info('Background job created', { jobId: id, type: data.type, userId: data.userId });
      return validated;
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
    logger.debug('Creating batch of background jobs', { count: jobs.length });
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
      await collection.insertMany(validatedJobs as any[]);

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
    logger.debug('Updating background job', { jobId: id });
    try {
      const existing = await this.findById(id);
      if (!existing) {
        logger.warn('Background job not found for update', { jobId: id });
        return null;
      }

      const now = this.getCurrentTimestamp();
      const updated: BackgroundJob = {
        ...existing,
        ...data,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now,
      };

      const validated = this.validate(updated);
      const collection = await this.getCollection();
      await collection.updateOne({ id }, { $set: validated as any });

      logger.debug('Background job updated', { jobId: id });
      return validated;
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
    logger.debug('Marking job as completed', { jobId: id });
    try {
      const collection = await this.getCollection();
      const now = this.getCurrentTimestamp();

      const updateData: Record<string, unknown> = {
        status: 'COMPLETED',
        completedAt: now,
        updatedAt: now,
      };

      if (result) {
        updateData['payload.result'] = result;
      }

      const updated = await collection.findOneAndUpdate(
        { id },
        { $set: updateData },
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
    logger.debug('Marking job as failed', { jobId: id, error: errorMessage });
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
        { id },
        {
          $set: {
            status: newStatus,
            lastError: errorMessage,
            scheduledAt,
            updatedAt: now,
          },
        },
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
    logger.debug('Deleting background job', { jobId: id });
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteOne({ id });

      if (result.deletedCount === 0) {
        logger.warn('Background job not found for deletion', { jobId: id });
        return false;
      }

      logger.debug('Background job deleted', { jobId: id });
      return true;
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
    logger.debug('Getting queue statistics', { userId });
    try {
      const collection = await this.getCollection();
      const matchStage = userId ? { $match: { userId } } : { $match: {} };

      const results = await collection
        .aggregate([
          matchStage,
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
            },
          },
        ])
        .toArray();

      const stats: QueueStats = {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        dead: 0,
        paused: 0,
      };

      for (const result of results) {
        const status = result._id as string;
        const count = result.count as number;
        switch (status) {
          case 'PENDING':
            stats.pending = count;
            break;
          case 'PROCESSING':
            stats.processing = count;
            break;
          case 'COMPLETED':
            stats.completed = count;
            break;
          case 'FAILED':
            stats.failed = count;
            break;
          case 'DEAD':
            stats.dead = count;
            break;
          case 'PAUSED':
            stats.paused = count;
            break;
        }
      }

      logger.debug('Queue statistics retrieved', { userId, stats });
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
    logger.debug('Cleaning up old completed jobs', { olderThan: olderThan.toISOString() });
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteMany({
        status: { $in: ['COMPLETED', 'DEAD'] },
        completedAt: { $lt: olderThan.toISOString() },
      });

      logger.info('Cleaned up old background jobs', { deletedCount: result.deletedCount });
      return result.deletedCount || 0;
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
    logger.debug('Cancelling background job', { jobId: id });
    try {
      const collection = await this.getCollection();
      const result = await collection.updateOne(
        { id, status: { $in: ['PENDING', 'FAILED'] } },
        {
          $set: {
            status: 'DEAD',
            lastError: 'Cancelled by user',
            updatedAt: this.getCurrentTimestamp(),
          },
        }
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
    logger.debug('Pausing background job', { jobId: id });
    try {
      const collection = await this.getCollection();
      const now = this.getCurrentTimestamp();

      const result = await collection.findOneAndUpdate(
        { id, status: { $in: ['PENDING', 'FAILED'] } },
        {
          $set: {
            status: 'PAUSED',
            updatedAt: now,
          },
        },
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
    logger.debug('Resuming background job', { jobId: id });
    try {
      const collection = await this.getCollection();
      const now = this.getCurrentTimestamp();

      const result = await collection.findOneAndUpdate(
        { id, status: 'PAUSED' },
        {
          $set: {
            status: 'PENDING',
            scheduledAt: now,
            updatedAt: now,
          },
        },
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
    logger.debug('Resetting stuck jobs', { timeoutMinutes });
    try {
      const collection = await this.getCollection();
      const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000).toISOString();
      const now = this.getCurrentTimestamp();

      const result = await collection.updateMany(
        {
          status: 'PROCESSING',
          startedAt: { $lt: cutoff },
        },
        {
          $set: {
            status: 'FAILED',
            lastError: `Timed out after ${timeoutMinutes} minutes`,
            updatedAt: now,
          },
        }
      );

      if (result.modifiedCount > 0) {
        logger.warn('Reset stuck processing jobs', { count: result.modifiedCount });
      }
      return result.modifiedCount || 0;
    } catch (error) {
      logger.error('Error resetting stuck jobs', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }
}
