/**
 * @jest-environment node
 *
 * The write partitioner's repository-key sets must match what the
 * repositories themselves declare.
 *
 * A forked job child buffers every repository write and the parent applies
 * each batch partitioned by target database, each partition in its own
 * transaction on its own connection (`lib/background-jobs/host/write-partition.ts`).
 * A repository that lives in a dedicated database but is missing from its key
 * set has its writes applied inside the MAIN connection's transaction — where
 * they auto-commit on the other connection, can neither roll back nor be
 * rolled back with the rest of the batch, and leak on failure. That is the
 * exact hazard the partitioner exists to remove, so the sets are checked
 * against every repository's `dbTarget` here rather than kept in sync by hand.
 */

import { createRepositories } from '@/lib/database/repositories';
import {
  MOUNT_INDEX_REPO_KEYS,
  LLM_LOGS_REPO_KEYS,
  classifyWriteTarget,
} from '@/lib/background-jobs/host/write-partition';

type Target = 'main' | 'mountIndex' | 'llmLogs';

function keysDeclaring(target: Target): Set<string> {
  const repos = createRepositories() as unknown as Record<string, { dbTarget?: Target }>;
  return new Set(
    Object.entries(repos)
      .filter(([, repo]) => (repo.dbTarget ?? 'main') === target)
      .map(([key]) => key),
  );
}

describe('write-partition repository keys', () => {
  it('MOUNT_INDEX_REPO_KEYS is exactly the set of repositories declaring dbTarget "mountIndex"', () => {
    expect(keysDeclaring('mountIndex')).toEqual(new Set(MOUNT_INDEX_REPO_KEYS));
  });

  it('LLM_LOGS_REPO_KEYS is exactly the set of repositories declaring dbTarget "llmLogs"', () => {
    expect(keysDeclaring('llmLogs')).toEqual(new Set(LLM_LOGS_REPO_KEYS));
  });

  it('every repository declares a target, and each one routes to its own partition', () => {
    const repos = createRepositories() as unknown as Record<string, { dbTarget?: Target }>;
    for (const [key, repo] of Object.entries(repos)) {
      expect(repo.dbTarget).toBeDefined();
      expect(classifyWriteTarget(`${key}.create`)).toBe(repo.dbTarget);
    }
  });
});
