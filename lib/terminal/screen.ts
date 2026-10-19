/**
 * Terminal screen model
 *
 * A server-side headless terminal emulator (`@xterm/headless`) that keeps the
 * same picture of a PTY session the operator's xterm.js pane shows. Text read
 * back for a non-terminal consumer — the `terminal_read` tool, Ariel's
 * periodic summaries — is rendered from this model rather than by stripping
 * escape codes from the raw byte stream.
 *
 * Stripping works for programs that write line by line, but a full-screen
 * program (Claude Code, vim, htop, less) paints its screen with cursor
 * addressing, cursor-right moves in place of spaces, and in-place redraws on
 * the alternate screen. Strip those codes and nothing says where any text
 * belongs: 422 KB of Claude Code output cleaned down to 526 characters of
 * fragments (bug 255). An emulator applies them instead.
 *
 * The emulator never answers the program: its `onData` (replies to device
 * status queries and the like) is not wired to the PTY — the operator's
 * browser terminal already answers those.
 *
 * @module terminal/screen
 */

import { Terminal } from '@xterm/headless';
import type { IBuffer, IMarker } from '@xterm/headless';
import { logger } from '@/lib/logger';

const screenLogger = logger.child({ module: 'terminal-screen' });

/** Lines of normal-buffer scrollback the server-side emulator keeps. */
export const SCREEN_SCROLLBACK_LINES = 5000;

/** Which xterm buffer a rendering came from. */
export type ScreenBufferKind = 'normal' | 'alternate';

export interface ScreenRendering {
  /**
   * `alternate` means a full-screen program owns the terminal and `lines` is
   * its current screen (there is no scrollback on the alternate screen);
   * `normal` means `lines` is the shell's scrollback plus the visible rows.
   */
  buffer: ScreenBufferKind;
  lines: string[];
  cols: number;
  rows: number;
}

/** What Ariel should post for a summary, or null when there is nothing new. */
export interface ScreenSummary {
  kind: 'output' | 'screen';
  text: string;
}

/**
 * Render rows `[from, to)` of a buffer as lines, trailing whitespace trimmed.
 * With `joinWrapped`, soft-wrapped rows are joined back onto the row they
 * continue — right for a shell's scrollback, wrong for a full-screen program's
 * screen, which is a grid: a program that fills a row to the edge and then
 * repositions the cursor leaves the wrap flag on the next row, and joining
 * would run the whole screen into one line.
 */
function readLines(buffer: IBuffer, from: number, to: number, joinWrapped: boolean): string[] {
  const out: string[] = [];
  for (let y = Math.max(0, from); y < to; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;
    // xterm's trimRight drops only never-written cells; full-screen programs
    // pad with written spaces, so trim those too.
    const continues = joinWrapped && buffer.getLine(y + 1)?.isWrapped === true;
    const text = continues ? line.translateToString(false) : line.translateToString(true).trimEnd();
    if (joinWrapped && line.isWrapped && y > from && out.length > 0) {
      out[out.length - 1] += text;
    } else {
      out.push(text);
    }
  }
  if (out.length > 0 && !out[out.length - 1].trim()) {
    // Trim the run of blank rows below the last written line.
    let end = out.length;
    while (end > 0 && !out[end - 1].trim()) end--;
    out.length = end;
  }
  return out;
}

export class TerminalScreen {
  private readonly term: Terminal;
  /** Normal-buffer line where the next plain-shell summary starts. */
  private summaryMarker: IMarker | undefined;
  /** Last line of the previous plain-shell summary, to avoid repeating it. */
  private lastSummaryTail: string | null = null;
  /** Text of the previous full-screen snapshot, to avoid posting an unchanged screen. */
  private lastSnapshot: string | null = null;

  constructor(cols: number, rows: number, scrollback: number = SCREEN_SCROLLBACK_LINES) {
    this.term = new Terminal({ cols, rows, scrollback, allowProposedApi: true });
  }

  get cols(): number {
    return this.term.cols;
  }

  get rows(): number {
    return this.term.rows;
  }

  write(data: string): void {
    this.term.write(data);
  }

  resize(cols: number, rows: number): void {
    try {
      this.term.resize(cols, rows);
    } catch (err) {
      screenLogger.warn('[TerminalScreen] Failed to resize emulator', {
        cols,
        rows,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Resolve once every write queued so far has been parsed. */
  settle(): Promise<void> {
    return new Promise((resolve) => this.term.write('', resolve));
  }

  /** The screen as it stands, after pending writes are parsed. */
  async render(): Promise<ScreenRendering> {
    await this.settle();
    const active = this.term.buffer.active;
    const buffer: ScreenBufferKind = active.type === 'alternate' ? 'alternate' : 'normal';
    return {
      buffer,
      lines: readLines(active, 0, active.length, buffer === 'normal'),
      cols: this.term.cols,
      rows: this.term.rows,
    };
  }

  /**
   * What Ariel should post now. A full-screen program gets a snapshot of its
   * screen (skipped when unchanged since the last one); a plain shell gets the
   * lines written since the previous summary, starting from the line the
   * cursor was on then — so a typed command shows up beside its output.
   */
  async takeSummary(): Promise<ScreenSummary | null> {
    await this.settle();
    const active = this.term.buffer.active;

    if (active.type === 'alternate') {
      const text = readLines(active, 0, active.length, false).join('\n');
      if (!text.trim() || text === this.lastSnapshot) return null;
      this.lastSnapshot = text;
      return { kind: 'screen', text };
    }
    this.lastSnapshot = null;

    // A marker scrolled out of the scrollback is disposed; start from the
    // oldest line still held.
    const from =
      this.summaryMarker && !this.summaryMarker.isDisposed ? this.summaryMarker.line : 0;
    const lines = readLines(active, from, active.length, true);
    if (lines.length > 0 && this.lastSummaryTail !== null && lines[0] === this.lastSummaryTail) {
      lines.shift();
    }

    this.summaryMarker?.dispose();
    this.summaryMarker = this.term.registerMarker(0);

    if (lines.length === 0 || !lines.join('').trim()) return null;
    this.lastSummaryTail = lines[lines.length - 1];
    return { kind: 'output', text: lines.join('\n') };
  }

  dispose(): void {
    this.summaryMarker?.dispose();
    this.term.dispose();
  }
}

/**
 * Render a recorded byte stream (a transcript tail) at the given geometry.
 * Used for exited sessions, whose live emulator is gone. A tail that starts
 * mid-sequence or after a full-screen program entered the alternate screen
 * renders approximately; the final screen is what it gets right.
 */
export async function renderTranscript(raw: string, cols: number, rows: number): Promise<ScreenRendering> {
  const screen = new TerminalScreen(cols, rows);
  try {
    screen.write(raw);
    return await screen.render();
  } finally {
    screen.dispose();
  }
}
