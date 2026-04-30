/**
 * Inter-Character Memory Job Handler — legacy drain
 *
 * Inter-character extraction is now folded into the per-turn MEMORY_EXTRACTION
 * job (every (observer, subject) pair runs as part of the same turn job, against
 * the joined transcript). This handler is retained only so any
 * INTER_CHARACTER_MEMORY rows that were enqueued before the cutover can drain
 * to COMPLETED instead of repeatedly failing and clogging the queue.
 *
 * No new INTER_CHARACTER_MEMORY jobs are enqueued from production code.
 */

import type { BackgroundJob } from '@/lib/schemas/types';
import { logger } from '@/lib/logger';

export async function handleInterCharacterMemory(job: BackgroundJob): Promise<void> {
  logger.debug('[InterCharacterMemory] Legacy drain — no-op', {
    jobId: job.id,
  });
}
