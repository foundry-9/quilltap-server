export const terminalReadToolDefinition = {
  type: 'function',
  function: {
    name: 'terminal_read',
    description: 'Read the recent scrollback from a terminal session in this chat. Returns the last N lines of output. The terminal is operator-controlled — this tool only reads; it cannot write. Use terminal_list first to discover live session ids.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Terminal session id (UUID). Get this from terminal_list.' },
        lines: { type: 'integer', minimum: 1, maximum: 2000, default: 200, description: 'Maximum number of lines to return from the tail of the scrollback. Default 200.' },
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

  return true;
}

export interface TerminalReadInput {
  sessionId: string;
  lines?: number;
}

export interface TerminalReadOutput {
  sessionId: string;
  shell: string;
  cwd: string;
  status: 'live' | 'exited';
  exitCode: number | null;
  lines: number;
  truncated: boolean;
  scrollback: string;
}
