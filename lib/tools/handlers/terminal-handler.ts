import fs from 'fs/promises';
import { ptyManager } from '@/lib/terminal/pty-manager';
import { getRepositories } from '@/lib/repositories/factory';
import { logger } from '@/lib/logger';
import type { ToolContext } from '../registry';
import type { TerminalReadInput, TerminalReadOutput } from '../terminal-read-tool';
import type { TerminalListInput, TerminalListOutput } from '../terminal-list-tool';

const moduleLogger = logger.child({ module: 'terminal-tool-handler' });

export class TerminalToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TerminalToolError';
  }
}

function tailLines(text: string, n: number): { lines: string; count: number; truncated: boolean } {
  const all = text.split(/\r?\n/);
  const tail = all.slice(Math.max(0, all.length - n));
  return { lines: tail.join('\n'), count: tail.length, truncated: all.length > tail.length };
}

async function tailFile(path: string, maxBytes = 1_000_000): Promise<string> {
  const fh = await fs.open(path, 'r');
  try {
    const stat = await fh.stat();
    const start = Math.max(0, stat.size - maxBytes);
    const buf = Buffer.alloc(stat.size - start);
    await fh.read(buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    await fh.close();
  }
}

export async function executeTerminalReadTool(
  input: TerminalReadInput,
  ctx: ToolContext,
): Promise<TerminalReadOutput> {
  if (!ctx.chatId) {
    throw new TerminalToolError('No chat context available');
  }

  const repos = getRepositories();
  const session = await repos.terminalSessions.findById(input.sessionId);

  if (!session) {
    throw new TerminalToolError(`Terminal session not found: ${input.sessionId}`);
  }

  if (session.chatId !== ctx.chatId) {
    throw new TerminalToolError('Session does not belong to this chat');
  }

  const lines = Math.min(input.lines ?? 200, 2000);
  let scrollback = '';
  let tailCount = 0;
  let truncated = false;

  const liveSession = ptyManager.get(input.sessionId);

  if (liveSession && session.exitedAt === null) {
    const ringBuffer = ptyManager.getRingBuffer(input.sessionId);
    if (ringBuffer) {
      const result = tailLines(ringBuffer, lines);
      scrollback = result.lines;
      tailCount = result.count;
      truncated = result.truncated;
    }
  } else if (session.transcriptPath) {
    try {
      const fileContent = await tailFile(session.transcriptPath);
      const result = tailLines(fileContent, lines);
      scrollback = result.lines;
      tailCount = result.count;
      truncated = result.truncated;
    } catch (err) {
      moduleLogger.warn('Failed to read transcript file', {
        sessionId: input.sessionId,
        transcriptPath: session.transcriptPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const status = session.exitedAt === null ? 'live' : 'exited';

  moduleLogger.debug('Terminal read executed', {
    sessionId: input.sessionId,
    status,
    linesReturned: tailCount,
    truncated,
  });

  return {
    sessionId: input.sessionId,
    shell: session.shell,
    cwd: session.cwd,
    status,
    exitCode: session.exitCode,
    lines: tailCount,
    truncated,
    scrollback,
  };
}

export async function executeTerminalListTool(
  _input: TerminalListInput,
  ctx: ToolContext,
): Promise<TerminalListOutput> {
  if (!ctx.chatId) {
    throw new TerminalToolError('No chat context available');
  }

  const repos = getRepositories();
  const sessions = await repos.terminalSessions.findByChatId(ctx.chatId);

  const output: TerminalListOutput = {
    sessions: sessions.map((session) => ({
      sessionId: session.id,
      label: session.label,
      shell: session.shell,
      cwd: session.cwd,
      startedAt: session.startedAt,
      status: session.exitedAt === null ? 'live' : 'exited',
      exitCode: session.exitCode,
    })),
  };

  moduleLogger.debug('Terminal list executed', {
    chatId: ctx.chatId,
    sessionCount: sessions.length,
  });

  return output;
}

export function formatTerminalReadResults(out: TerminalReadOutput): string {
  const statusBadge = out.status === 'live' ? '🔴 LIVE' : '⚫ EXITED';
  const exitCodeStr = out.exitCode !== null ? ` (exit code: ${out.exitCode})` : '';
  const truncationStr = out.truncated ? '\n\n[scrollback truncated — showing last lines only]' : '';

  return `${statusBadge}${exitCodeStr}
Shell: ${out.shell}
Working Directory: ${out.cwd}
Lines: ${out.lines}

\`\`\`
${out.scrollback}
\`\`\`${truncationStr}`;
}

export function formatTerminalListResults(out: TerminalListOutput): string {
  if (out.sessions.length === 0) {
    return 'No terminal sessions in this chat.';
  }

  const lines = out.sessions.map((s) => {
    const statusEmoji = s.status === 'live' ? '🔴' : '⚫';
    const label = s.label ? ` "${s.label}"` : '';
    const exitStr = s.exitCode !== null ? ` [exit ${s.exitCode}]` : '';
    return `${statusEmoji} ${s.sessionId}${label} — ${s.shell} in ${s.cwd}${exitStr}`;
  });

  return `**Terminal Sessions**\n\n${lines.join('\n')}`;
}
