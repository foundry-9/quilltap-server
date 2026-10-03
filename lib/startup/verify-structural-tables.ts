/**
 * Boot-time structural table check (bug 176).
 *
 * The migration runner skips any migration already in `migrations_state`
 * before it asks that migration's `shouldRun`, so once the mount-index and
 * help-chunks migrations are ledgered, nothing at boot looks at those tables
 * again. A table damaged after that (a column renamed by hand or by a bad
 * restore, a table swapped for a view) used to fail only the repository's
 * lazy ensure, on every access, into an empty fallback — every document-store
 * read came back empty behind a healthy `/api/health`.
 *
 * This pass runs once, after the migrations, and asks every repository that
 * owns its table's DDL (the dedicated mount-index and LLM-logs repositories,
 * and the help-chunks collection) to verify its structure with the fallback
 * off. It does not stop the boot: an instance with a damaged document store
 * must still be reachable so the operator can restore a backup. Instead each
 * problem is logged once at ERROR here and recorded on the startup state,
 * where `/api/health` reports it as degraded.
 */

import { logger } from '@/lib/logger';
import { startupState } from './startup-state';

/** Anything in the repository container that can check its own table. */
interface StructureVerifiable {
  verifyStructure(): Promise<string | null>;
}

function isStructureVerifiable(value: unknown): value is StructureVerifiable {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<StructureVerifiable>).verifyStructure === 'function'
  );
}

/**
 * Verify every structure-verifiable repository's table. Returns the problems
 * found (also recorded on `startupState`); an empty array means all sound.
 */
export async function verifyStructuralTables(): Promise<string[]> {
  const log = logger.child({ context: 'startup.verify-structural-tables' });
  // Connecting the backend is what opens the dedicated databases
  const { getDatabaseAsync } = await import('@/lib/database/manager');
  await getDatabaseAsync();
  const { getRepositories } = await import('@/lib/repositories/factory');
  const repos = getRepositories() as unknown as Record<string, unknown>;

  const problems: string[] = [];
  const seen = new Set<unknown>();
  let checked = 0;

  for (const [key, repo] of Object.entries(repos)) {
    // `images` aliases `files`; check each instance once
    if (seen.has(repo) || !isStructureVerifiable(repo)) continue;
    seen.add(repo);
    checked++;

    const problem = await repo.verifyStructure();
    if (problem) {
      problems.push(problem);
      log.error('Structural table check failed; reads through this repository will come back empty', {
        repository: key,
        problem,
      });
    }
  }

  startupState.setStructuralProblems(problems);

  if (problems.length === 0) {
    log.debug('Structural tables verified', { checked });
  } else {
    log.error('Structural tables damaged; /api/health will report degraded until repaired', {
      checked,
      damaged: problems.length,
    });
  }

  return problems;
}
