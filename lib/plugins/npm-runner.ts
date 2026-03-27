/**
 * Local npm Runner
 *
 * Provides a way to invoke npm commands using the locally-installed npm package
 * rather than relying on a system-wide npm binary being in PATH.
 *
 * This solves the problem where Electron on macOS gets a minimal PATH
 * (/usr/bin:/bin:/usr/sbin:/sbin) that doesn't include npm, and avoids
 * version-incompatibility issues between different system npm installations.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { logger } from '@/lib/logger';

const execAsync = promisify(exec);

/**
 * Path to the locally-installed npm CLI script.
 * npm is installed as a project dependency so it's always available
 * regardless of system PATH configuration.
 */
const NPM_CLI_PATH = path.join(process.cwd(), 'node_modules', 'npm', 'bin', 'npm-cli.js');

/**
 * Run an npm command using the locally-installed npm package.
 *
 * Instead of shelling out to a bare `npm` command (which requires npm to be
 * in PATH), this invokes the local npm-cli.js directly via the current Node
 * process's execPath. In Electron with ELECTRON_RUN_AS_NODE=1, this is the
 * same Node runtime running the server — no version mismatch possible.
 *
 * @param args - npm command arguments (e.g., ['install', 'package-name', '--save'])
 * @param options - exec options (cwd, timeout, env)
 * @returns stdout and stderr from the npm command
 */
export async function runNpm(
  args: string[],
  options: {
    cwd?: string;
    timeout?: number;
    env?: Record<string, string | undefined>;
  } = {}
): Promise<{ stdout: string; stderr: string }> {
  // Use process.execPath so we run with the same Node binary as the server.
  // In Electron (ELECTRON_RUN_AS_NODE=1) this is Electron's bundled Node;
  // in dev/Docker it's the system Node that started the server.
  const nodeExe = process.execPath;
  const command = `"${nodeExe}" "${NPM_CLI_PATH}" ${args.join(' ')}`;

  logger.debug('Running local npm command', {
    context: 'NpmRunner.runNpm',
    args,
    cwd: options.cwd,
    nodeExe,
    npmCliPath: NPM_CLI_PATH,
  });

  return execAsync(command, {
    cwd: options.cwd,
    timeout: options.timeout,
    env: options.env ? { ...process.env, ...options.env } : undefined,
  });
}
