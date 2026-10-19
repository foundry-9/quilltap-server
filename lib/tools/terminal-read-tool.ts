import { z } from 'zod';
import { zodToOpenAISchema } from './zod-to-openai-schema';
import { llmNumber } from './llm-number';

/**
 * Zod schema for the terminal read tool's input.
 */
export const terminalReadToolInputSchema = z.object({
  sessionId: z
    .string()
    .describe('Terminal session id (UUID). Get this from terminal_list.'),
  lines: llmNumber(
    z
      .number()
      .int()
      .min(1)
      .max(2000)
      .describe('Maximum number of lines to return from the tail of the scrollback when start/end are not provided. Default 200. Ignored when start or end is set.')
  )
    .default(200)
    .optional(),
  start: llmNumber(
    z
      .number()
      .int()
      .describe('Optional 0-indexed inclusive start line. Negative values mean (last line number) - abs(value). Defaults to 0 when end is provided alone.')
  )
    .optional(),
  end: llmNumber(
    z
      .number()
      .int()
      .describe('Optional 0-indexed inclusive end line. Negative values mean (last line number) - abs(value). Defaults to the last line number when start is provided alone.')
  )
    .optional(),
  raw: z
    .boolean()
    .default(false)
    .describe('When true, the response also includes a rawScrollback field: the last 64 KB of the raw byte stream, ANSI escape codes preserved. The default scrollback field is always rendered text.')
    .optional(),
});

export type TerminalReadInput = z.infer<typeof terminalReadToolInputSchema>;

export const terminalReadToolDefinition = {
  type: 'function',
  function: {
    name: 'terminal_read',
    description: 'Read a terminal session in this chat as rendered text — what the operator\'s terminal pane shows. A plain shell returns its scrollback (the last 200 lines by default). While a full-screen program such as an editor or Claude Code has the terminal, the result is that program\'s current screen instead, and says so. Use start/end to read a specific line window (0-indexed, inclusive; negative values count back from the last line — e.g. start=-50 means "50 lines before the last"). Set raw=true to additionally include the raw byte stream. The terminal is operator-controlled — this tool only reads; it cannot write. Use terminal_list first to discover live session ids.',
    parameters: zodToOpenAISchema(terminalReadToolInputSchema),
  },
};

export function validateTerminalReadInput(input: unknown): TerminalReadInput | null {
  const parsed = terminalReadToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
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
  /** `alternate`: a full-screen program has the terminal and `scrollback` is its current screen. */
  buffer: 'normal' | 'alternate';
  scrollback: string;
  rawScrollback?: string;
}
