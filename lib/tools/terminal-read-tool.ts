export const terminalReadToolDefinition = {
  type: 'function',
  function: {
    name: 'terminal_read',
    description: 'Read scrollback from a terminal session in this chat. By default the output is cleaned of ANSI escape codes and the last 200 lines are returned. Use start/end to read a specific line window (0-indexed, inclusive; negative values count back from the last line — e.g. start=-50 means "50 lines before the last"). Set raw=true to additionally include the unstripped output. The terminal is operator-controlled — this tool only reads; it cannot write. Use terminal_list first to discover live session ids.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Terminal session id (UUID). Get this from terminal_list.' },
        lines: { type: 'integer', minimum: 1, maximum: 2000, default: 200, description: 'Maximum number of lines to return from the tail of the scrollback when start/end are not provided. Default 200. Ignored when start or end is set.' },
        start: { type: 'integer', description: 'Optional 0-indexed inclusive start line. Negative values mean (last line number) - abs(value). Defaults to 0 when end is provided alone.' },
        end: { type: 'integer', description: 'Optional 0-indexed inclusive end line. Negative values mean (last line number) - abs(value). Defaults to the last line number when start is provided alone.' },
        raw: { type: 'boolean', default: false, description: 'When true, the response also includes a rawScrollback field with ANSI escape codes preserved. The default scrollback field is always cleaned.' },
      },
      required: ['sessionId'],
    },
  },
};

export function validateTerminalReadInput(input: unknown): input is TerminalReadInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  if (typeof obj.sessionId !== 'string') {
    return false;
  }

  if (obj.lines !== undefined) {
    if (typeof obj.lines !== 'number' || !Number.isInteger(obj.lines) || obj.lines < 1 || obj.lines > 2000) {
      return false;
    }
  }

  if (obj.start !== undefined) {
    if (typeof obj.start !== 'number' || !Number.isInteger(obj.start)) {
      return false;
    }
  }

  if (obj.end !== undefined) {
    if (typeof obj.end !== 'number' || !Number.isInteger(obj.end)) {
      return false;
    }
  }

  if (obj.raw !== undefined && typeof obj.raw !== 'boolean') {
    return false;
  }

  return true;
}

export interface TerminalReadInput {
  sessionId: string;
  lines?: number;
  start?: number;
  end?: number;
  raw?: boolean;
}

export interface TerminalReadOutput {
  sessionId: string;
  shell: string;
  cwd: string;
  status: 'live' | 'exited';
  exitCode: number | null;
  lines: number;
  totalLines: number;
  startLine: number;
  endLine: number;
  truncated: boolean;
  scrollback: string;
  rawScrollback?: string;
}
