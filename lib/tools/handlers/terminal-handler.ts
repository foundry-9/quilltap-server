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

const MAX_RETURN_LINES = 2000;

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/**
 * Strip ANSI escape sequences. Covers CSI (ESC [ … final), OSC (ESC ] … BEL/ST),
 * two-byte intermediate+final (ESC SP F, ESC ( B, …) and the full single-byte
 * range (Fp 0x30-3F, Fe 0x40-5F, Fs 0x60-7E — e.g. ESC =, ESC >, ESC 7), plus
 * any orphan trailing ESC.
 */
function stripAnsi(input: string): string {
  return input.replace(
    /\x1B\[[0-?]*[ -/]*[@-~]|\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)|\x1B[ -/][0-~]|\x1B[0-~]|\x1B/g,
    '',
  );
}

/**
 * Apply backspace (0x08) by erasing the prior character on the same line.
 * Orphan backspaces at the start of a line are dropped silently.
 */
function applyBackspaces(input: string): string {
  if (input.indexOf('\b') === -1) return input;
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '\b') {
      if (out.length > 0 && out[out.length - 1] !== '\n') {
        out = out.slice(0, -1);
      }
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Treat lone carriage returns (not part of CRLF) as "reset to start of line":
 * keep only the content after the last \r on each line. Approximates the way a
 * terminal redraws an in-place prompt or progress indicator.
 */
function applyCarriageReturns(input: string): string {
  if (input.indexOf('\r') === -1) return input;
  // Normalize CRLF first so we don't accidentally collapse line breaks.
  const normalized = input.replace(/\r\n/g, '\n');
  return normalized
    .split('\n')
    .map((line) => {
      const idx = line.lastIndexOf('\r');
      return idx >= 0 ? line.slice(idx + 1) : line;
    })
    .join('\n');
}

function cleanTerminalOutput(input: string): string {
  if (!input) return input;
  return applyCarriageReturns(applyBackspaces(stripAnsi(input)));
}

/**
 * Resolve a possibly-negative line index to a concrete in-range index.
 * Negative values count back from the last line number (last_index - abs(value)).
 */
function resolveIndex(value: number, lastIndex: number): number {
  if (value < 0) return lastIndex - Math.abs(value);
  return value;
}

interface SliceResult {
  text: string;
  count: number;
  startLine: number;
  endLine: number;
  truncated: boolean;
}

function sliceByRange(
  all: string[],
  start: number | undefined,
  end: number | undefined,
): SliceResult {
  const total = all.length;
  if (total === 0) {
    return { text: '', count: 0, startLine: 0, endLine: 0, truncated: false };
  }
  const lastIndex = total - 1;
  const rawStart = start === undefined ? 0 : resolveIndex(start, lastIndex);
  const rawEnd = end === undefined ? lastIndex : resolveIndex(end, lastIndex);
  const lo = Math.max(0, Math.min(rawStart, rawEnd));
  const hi = Math.min(lastIndex, Math.max(rawStart, rawEnd));
  let truncated = false;
  let effectiveHi = hi;
  if (hi - lo + 1 > MAX_RETURN_LINES) {
    effectiveHi = lo + MAX_RETURN_LINES - 1;
    truncated = true;
  }
  const slice = all.slice(lo, effectiveHi + 1);
  return {
    text: slice.join('\n'),
    count: slice.length,
    startLine: lo,
    endLine: effectiveHi,
    truncated,
  };
}

function tailByCount(all: string[], n: number): SliceResult {
  const total = all.length;
  if (total === 0) {
    return { text: '', count: 0, startLine: 0, endLine: 0, truncated: false };
  }
  const cap = Math.min(n, MAX_RETURN_LINES);
  const lo = Math.max(0, total - cap);
  const hi = total - 1;
  const slice = all.slice(lo, hi + 1);
  return {
    text: slice.join('\n'),
    count: slice.length,
    startLine: lo,
    endLine: hi,
    truncated: lo > 0,
  };
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

  let fullContent = '';

  const liveSession = ptyManager.get(input.sessionId);

  if (liveSession && session.exitedAt == null) {
    fullContent = ptyManager.getRingBuffer(input.sessionId) ?? '';
  } else if (session.transcriptPath) {
    try {
      fullContent = await tailFile(session.transcriptPath);
    } catch (err) {
      moduleLogger.warn('Failed to read transcript file', {
        sessionId: input.sessionId,
        transcriptPath: session.transcriptPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const allLines = splitLines(fullContent);
  const totalLines = allLines.length;

  const useSlice = input.start !== undefined || input.end !== undefined;
  const result = useSlice
    ? sliceByRange(allLines, input.start, input.end)
    : tailByCount(allLines, input.lines ?? 200);

  const cleanedScrollback = cleanTerminalOutput(result.text);
  const status = session.exitedAt == null ? 'live' : 'exited';

  moduleLogger.debug('Terminal read executed', {
    sessionId: input.sessionId,
    status,
    mode: useSlice ? 'slice' : 'tail',
    startLine: result.startLine,
    endLine: result.endLine,
    linesReturned: result.count,
    totalLines,
    truncated: result.truncated,
    raw: input.raw === true,
  });

  const output: TerminalReadOutput = {
    sessionId: input.sessionId,
    shell: session.shell,
    cwd: session.cwd,
    status,
    exitCode: session.exitCode ?? null,
    lines: result.count,
    totalLines,
    startLine: result.startLine,
    endLine: result.endLine,
    truncated: result.truncated,
    scrollback: cleanedScrollback,
  };

  if (input.raw === true) {
    output.rawScrollback = result.text;
  }

  return output;
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
      label: session.label ?? null,
      shell: session.shell,
      cwd: session.cwd,
      startedAt: session.startedAt,
      status: session.exitedAt == null ? 'live' : 'exited',
      exitCode: session.exitCode ?? null,
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
  const rangeStr = out.totalLines > 0
    ? `Lines: ${out.lines} (showing ${out.startLine}–${out.endLine} of ${out.totalLines})`
    : `Lines: 0`;
  const truncationStr = out.truncated ? '\n\n[scrollback truncated — output exceeded the per-read line cap]' : '';
  const rawBlock = out.rawScrollback !== undefined
    ? `\n\nRaw (ANSI preserved):\n\`\`\`\n${out.rawScrollback}\n\`\`\``
    : '';

  return `${statusBadge}${exitCodeStr}
Shell: ${out.shell}
Working Directory: ${out.cwd}
${rangeStr}

\`\`\`
${out.scrollback}
\`\`\`${truncationStr}${rawBlock}`;
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
