/**
 * The job child's start-up sequence: open the databases, then load plugins.
 *
 * The child connects its database backend lazily, and connecting the backend
 * is also what opens the dedicated mount-index and LLM-logs databases. Their
 * repositories never trigger that connect themselves — they read a
 * process-global handle (`requireMountIndexDb`) that is null until something
 * else has initialized the backend. A job whose first database touch was a
 * mount-index read (an EMBEDDING_GENERATE for a document chunk, queued by the
 * boot-time store rescan) therefore found "Mount index database not
 * initialized" and marked the chunk FAILED, about 200 ms before the plugin
 * load happened to open the backend on its own.
 *
 * `initializeChildRuntime` runs both steps in order, each in its own guard,
 * so a database failure still lets the plugin load proceed (and is logged
 * here; handlers then fail as they would have). It is the init passed to
 * `startPluginInitialization`, so every job waits for the whole sequence via
 * `whenPluginsReady`.
 *
 * @module background-jobs/child/child-startup
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';

const log = logger.child({ module: 'jobs:child:startup' });

/** The two start-up steps, injected so the order can be tested. */
export interface ChildRuntimeSteps {
  /** Connect the database backend (main, mount index, LLM logs). */
  initDatabase: () => Promise<unknown>;
  /** Load the plugin/provider registry. */
  initPlugins: () => Promise<unknown>;
}

/**
 * Open the databases, then load the plugins. Never rejects: each step's
 * failure is logged and the next step still runs.
 */
export async function initializeChildRuntime(steps: ChildRuntimeSteps): Promise<void> {
  try {
    await steps.initDatabase();
    log.info('Database backend connected in child');
  } catch (err) {
    log.error('Failed to connect the database backend in child; jobs needing it will fail', {
      error: getErrorMessage(err),
    });
  }

  try {
    await steps.initPlugins();
  } catch (err) {
    log.error('Failed to initialize plugin registry in child; LLM/embedding handlers will fail until restart', {
      error: getErrorMessage(err),
    });
  }
}
