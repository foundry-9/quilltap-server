/**
 * Terminal output cleaning utilities.
 *
 * Shared between the `terminal_read` tool handler (which serves cleaned
 * scrollback to the LLM) and the PTY manager (which posts cleaned periodic
 * summaries via Ariel). The raw ring buffer keeps original bytes; these
 * helpers run only when text is being shown to a non-terminal consumer.
 */

/**
 * Strip ANSI escape sequences. Covers CSI (ESC [ … final), OSC (ESC ] … BEL/ST),
 * two-byte intermediate+final (ESC SP F, ESC ( B, …) and the full single-byte
 * range (Fp 0x30-3F, Fe 0x40-5F, Fs 0x60-7E — e.g. ESC =, ESC >, ESC 7), plus
 * any orphan trailing ESC.
 */
export function stripAnsi(input: string): string {
  return input.replace(
    /\x1B\[[0-?]*[ -/]*[@-~]|\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)|\x1B[ -/][0-~]|\x1B[0-~]|\x1B/g,
    '',
  );
}

/**
 * Apply backspace (0x08) by erasing the prior character on the same line.
 * Orphan backspaces at the start of a line are dropped silently.
 */
export function applyBackspaces(input: string): string {
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
export function applyCarriageReturns(input: string): string {
  if (input.indexOf('\r') === -1) return input;
  const normalized = input.replace(/\r\n/g, '\n');
  return normalized
    .split('\n')
    .map((line) => {
      const idx = line.lastIndexOf('\r');
      return idx >= 0 ? line.slice(idx + 1) : line;
    })
    .join('\n');
}

export function cleanTerminalOutput(input: string): string {
  if (!input) return input;
  return applyCarriageReturns(applyBackspaces(stripAnsi(input)));
}
