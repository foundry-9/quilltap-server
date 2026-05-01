export const terminalListToolDefinition = {
  type: 'function',
  function: {
    name: 'terminal_list',
    description: 'List all terminal sessions in this chat (live and exited). Returns a brief summary per session including id, shell, cwd, and status.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export function validateTerminalListInput(input: unknown): input is TerminalListInput {
  return typeof input === 'object';
}

export interface TerminalListInput {}

export interface TerminalListOutput {
  sessions: Array<{
    sessionId: string;
    label: string | null;
    shell: string;
    cwd: string;
    startedAt: string;
    status: 'live' | 'exited';
    exitCode: number | null;
  }>;
}
