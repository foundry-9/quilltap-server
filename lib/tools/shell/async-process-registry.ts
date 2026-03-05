/**
 * Async Process Registry
 *
 * In-memory registry for tracking asynchronous shell processes.
 * Stores child process handles and captures output streams for
 * later retrieval via the async_result tool.
 *
 * @module tools/shell/async-process-registry
 */

import type { ChildProcess } from 'child_process';
import { logger } from '@/lib/logger';
import type { AsyncProcessRecord } from './shell-session.types';

interface ProcessEntry {
  process: ChildProcess;
  stdout: string[];
  stderr: string[];
  command: string;
  startedAt: string;
  status: 'running' | 'complete' | 'timeout';
  exitCode?: number;
  completedAt?: string;
}

/** In-memory map of PID -> process entry */
const processMap = new Map<number, ProcessEntry>();

const moduleLogger = logger.child({ module: 'async-process-registry' });

/**
 * Register a new async process for tracking
 */
export function registerProcess(pid: number, childProcess: ChildProcess, command: string): void {
  const entry: ProcessEntry = {
    process: childProcess,
    stdout: [],
    stderr: [],
    command,
    startedAt: new Date().toISOString(),
    status: 'running',
  };

  // Capture stdout
  if (childProcess.stdout) {
    childProcess.stdout.on('data', (data: Buffer) => {
      entry.stdout.push(data.toString());
    });
  }

  // Capture stderr
  if (childProcess.stderr) {
    childProcess.stderr.on('data', (data: Buffer) => {
      entry.stderr.push(data.toString());
    });
  }

  // Handle process exit
  childProcess.on('exit', (code: number | null) => {
    entry.status = 'complete';
    entry.exitCode = code ?? 1;
    entry.completedAt = new Date().toISOString();
    moduleLogger.debug('Async process completed', { pid, exitCode: code, command });
  });

  // Handle process error
  childProcess.on('error', (error: Error) => {
    entry.status = 'complete';
    entry.exitCode = 1;
    entry.completedAt = new Date().toISOString();
    entry.stderr.push(error.message);
    moduleLogger.warn('Async process error', { pid, error: error.message, command });
  });

  processMap.set(pid, entry);
  moduleLogger.info('Registered async process', { pid, command });
}

/**
 * Get the status and output of a tracked process
 */
export function getProcessStatus(pid: number): AsyncProcessRecord | null {
  const entry = processMap.get(pid);
  if (!entry) {
    return null;
  }

  return {
    pid,
    command: entry.command,
    startedAt: entry.startedAt,
    status: entry.status,
    exitCode: entry.exitCode,
    stdout: entry.stdout.join(''),
    stderr: entry.stderr.join(''),
    completedAt: entry.completedAt,
  };
}

/**
 * Kill a tracked async process
 */
export function killProcess(pid: number): boolean {
  const entry = processMap.get(pid);
  if (!entry || entry.status !== 'running') {
    return false;
  }

  try {
    entry.process.kill('SIGTERM');
    entry.status = 'timeout';
    entry.completedAt = new Date().toISOString();
    moduleLogger.info('Killed async process', { pid, command: entry.command });
    return true;
  } catch (error) {
    moduleLogger.warn('Failed to kill async process', {
      pid,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Check if a PID is tracked in the registry
 */
export function hasProcess(pid: number): boolean {
  return processMap.has(pid);
}

/**
 * Clean up completed processes older than the given age
 */
export function cleanupOldProcesses(maxAgeMs: number = 3600000): number {
  const now = Date.now();
  let cleaned = 0;

  for (const [pid, entry] of processMap.entries()) {
    if (entry.status !== 'running') {
      const completedAt = entry.completedAt ? new Date(entry.completedAt).getTime() : 0;
      if (now - completedAt > maxAgeMs) {
        processMap.delete(pid);
        cleaned++;
      }
    }
  }

  if (cleaned > 0) {
    moduleLogger.debug('Cleaned up old async processes', { cleaned });
  }

  return cleaned;
}

/**
 * Get count of tracked processes (for testing/debugging)
 */
export function getProcessCount(): number {
  return processMap.size;
}

/**
 * Clear all tracked processes (for testing)
 */
export function clearAllProcesses(): void {
  processMap.clear();
}
