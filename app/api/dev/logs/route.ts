/**
 * SSE endpoint for streaming server logs in development mode
 * This endpoint tails both combined.log (Winston) and stdout.log (Next.js output)
 *
 * SECURITY: This endpoint is only available in development mode
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDevelopment } from '@/lib/env';
import { watch, FSWatcher } from 'fs';
import { open, stat } from 'fs/promises';
import { resolve } from 'path';
import { logger } from '@/lib/logger';

const LOG_FILE_PATH = resolve(process.cwd(), 'logs', 'combined.log');
const STDOUT_LOG_PATH = resolve(process.cwd(), 'logs', 'stdout.log');

// Track active connections for cleanup
const activeConnections = new Set<ReadableStreamDefaultController>();

interface LogFileWatcher {
  path: string;
  watcher: FSWatcher | null;
  lastPosition: number;
  source: 'winston' | 'stdout';
}

export async function GET(request: NextRequest) {
  // Security check: Only allow in development
  if (!isDevelopment) {
    logger.warn('Attempt to access dev logs endpoint in production');
    return NextResponse.json(
      { error: 'This endpoint is only available in development mode' },
      { status: 404 }
    );
  }

  logger.debug('Dev logs SSE connection initiated');

  // Get query params
  const searchParams = request.nextUrl.searchParams;
  const initialLines = parseInt(searchParams.get('lines') || '100', 10);

  let controller: ReadableStreamDefaultController;
  const watchers: LogFileWatcher[] = [];
  let isClosing = false;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  // Helper to send a log entry to the client
  function sendLogEntry(entry: object): void {
    if (isClosing) return;
    try {
      controller.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify(entry)}\n\n`)
      );
    } catch {
      // Connection likely closed
    }
  }

  // Helper to process a log line and send to client
  function processLine(line: string, source: 'winston' | 'stdout'): void {
    if (isClosing) return;
    try {
      const parsed = JSON.parse(line);
      sendLogEntry({ type: 'log', source, ...parsed });
    } catch {
      // Line wasn't valid JSON, send as raw
      sendLogEntry({ type: 'raw', source, content: line });
    }
  }

  // Set up watching for a single log file
  async function setupFileWatcher(
    filePath: string,
    source: 'winston' | 'stdout',
    readInitial: boolean
  ): Promise<LogFileWatcher> {
    const watcherState: LogFileWatcher = {
      path: filePath,
      watcher: null,
      lastPosition: 0,
      source,
    };

    try {
      // Check if file exists
      await stat(filePath);

      // Read initial lines if requested
      if (readInitial) {
        try {
          const initialContent = await readLastLines(filePath, initialLines);
          for (const line of initialContent) {
            if (isClosing) break;
            processLine(line, source);
          }
        } catch {
          // File might be empty or unreadable
        }
      }

      // Get current file position
      try {
        const stats = await stat(filePath);
        watcherState.lastPosition = stats.size;
      } catch {
        watcherState.lastPosition = 0;
      }

      // Watch for changes
      watcherState.watcher = watch(filePath, async (eventType) => {
        if (isClosing) return;

        if (eventType === 'change') {
          try {
            const newContent = await readNewContent(filePath, watcherState.lastPosition);
            if (newContent.content.length > 0) {
              watcherState.lastPosition = newContent.newPosition;
              const lines = newContent.content.split('\n').filter(Boolean);

              for (const line of lines) {
                if (isClosing) break;
                processLine(line, source);
              }
            }
          } catch {
            // Error reading file, ignore
          }
        }
      });
    } catch {
      // File doesn't exist yet, that's okay
    }

    return watcherState;
  }

  const stream = new ReadableStream({
    async start(ctrl) {
      controller = ctrl;
      activeConnections.add(controller);

      try {
        // Send initial message
        sendLogEntry({ type: 'info', message: 'Connected to server logs' });

        // Set up watchers for both log files
        // Winston logs (combined.log) - read initial content
        const winstonWatcher = await setupFileWatcher(LOG_FILE_PATH, 'winston', true);
        watchers.push(winstonWatcher);

        // Stdout logs - read initial content too
        const stdoutWatcher = await setupFileWatcher(STDOUT_LOG_PATH, 'stdout', true);
        watchers.push(stdoutWatcher);

        // Send heartbeat to keep connection alive
        heartbeatInterval = setInterval(() => {
          if (isClosing) {
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            return;
          }
          try {
            controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'));
          } catch {
            if (heartbeatInterval) clearInterval(heartbeatInterval);
          }
        }, 30000);

        // Handle client disconnect via abort signal
        request.signal.addEventListener('abort', () => {
          isClosing = true;
          cleanup();
        });

      } catch (err) {
        logger.error('Error in dev logs stream', {
          error: err instanceof Error ? err.message : String(err)
        });
        cleanup();
      }
    },

    cancel() {
      isClosing = true;
      cleanup();
    }
  });

  function cleanup() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    for (const w of watchers) {
      if (w.watcher) {
        w.watcher.close();
        w.watcher = null;
      }
    }
    watchers.length = 0;
    activeConnections.delete(controller);
    logger.debug('Dev logs SSE connection closed');
  }

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}

/**
 * Read the last N lines from a file
 */
async function readLastLines(filePath: string, numLines: number): Promise<string[]> {
  const { createReadStream } = await import('fs');
  const readline = await import('readline');

  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    const rl = readline.createInterface({
      input: createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity
    });

    rl.on('line', (line) => {
      lines.push(line);
      // Keep only the last N lines
      if (lines.length > numLines) {
        lines.shift();
      }
    });

    rl.on('close', () => {
      resolve(lines);
    });

    rl.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Read new content from a file starting at a given position
 */
async function readNewContent(
  filePath: string,
  startPosition: number
): Promise<{ content: string; newPosition: number }> {
  const fileHandle = await open(filePath, 'r');

  try {
    const stats = await fileHandle.stat();
    const newSize = stats.size;

    // Handle file rotation (new file is smaller)
    if (newSize < startPosition) {
      startPosition = 0;
    }

    const bytesToRead = newSize - startPosition;
    if (bytesToRead <= 0) {
      return { content: '', newPosition: newSize };
    }

    const buffer = Buffer.alloc(bytesToRead);
    await fileHandle.read(buffer, 0, bytesToRead, startPosition);

    return {
      content: buffer.toString('utf8'),
      newPosition: newSize
    };
  } finally {
    await fileHandle.close();
  }
}
