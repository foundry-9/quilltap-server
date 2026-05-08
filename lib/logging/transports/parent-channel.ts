/**
 * Parent-channel log transport (used inside the forked job-runner child).
 *
 * Posts log records to the parent process via `process.send()`. The parent
 * receives them in `processor-host.ts` and re-emits each record through the
 * main-thread logger's existing transports — so `combined.log` and
 * `error.log` keep a single writer (no rotation races between processes).
 */

import { LogTransport, LogData } from './base';

export class ParentChannelTransport implements LogTransport {
  write(data: LogData): void {
    if (typeof process.send !== 'function') return;
    try {
      process.send({
        type: 'log',
        record: {
          level: data.level,
          message: data.message,
          timestamp: data.timestamp,
          context: data.context?.module || data.context?.context || undefined,
          meta: { ...(data.context ?? {}), ...(data.error ? { error: data.error } : {}) },
        },
      });
    } catch {
      // If send fails, fall back to stderr so the record isn't lost.
      try {
        process.stderr.write(
          `[child-log] ${data.timestamp} ${data.level}: ${data.message}\n`
        );
      } catch { /* worst case, swallow */ }
    }
  }
}
