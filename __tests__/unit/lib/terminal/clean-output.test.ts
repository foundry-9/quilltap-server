import { describe, expect, it } from '@jest/globals'

import {
  applyBackspaces,
  applyCarriageReturns,
  cleanTerminalOutput,
  stripAnsi,
} from '@/lib/terminal/clean-output'

describe('stripAnsi', () => {
  it('returns plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world')
  })

  it('strips basic CSI color codes', () => {
    expect(stripAnsi('\x1B[31mred\x1B[0m')).toBe('red')
  })

  it('strips bold/underline sequences', () => {
    expect(stripAnsi('\x1B[1mbold\x1B[22m')).toBe('bold')
  })

  it('strips cursor movement sequences', () => {
    // Move cursor up 2 lines
    expect(stripAnsi('\x1B[2Atext')).toBe('text')
  })

  it('strips OSC sequences (window title)', () => {
    expect(stripAnsi('\x1B]0;Title\x07suffix')).toBe('suffix')
  })

  it('strips OSC sequences terminated with ST', () => {
    expect(stripAnsi('\x1B]0;Title\x1B\\suffix')).toBe('suffix')
  })

  it('strips two-byte escape sequences', () => {
    // ESC ( B — select character set
    expect(stripAnsi('\x1B(Btext')).toBe('text')
  })

  it('strips orphan trailing ESC', () => {
    expect(stripAnsi('text\x1B')).toBe('text')
  })

  it('strips multiple sequences in a row', () => {
    expect(stripAnsi('\x1B[32m\x1B[1mgreen bold\x1B[0m')).toBe('green bold')
  })

  it('handles empty input', () => {
    expect(stripAnsi('')).toBe('')
  })
})

describe('applyBackspaces', () => {
  it('returns input unchanged when no backspace is present', () => {
    expect(applyBackspaces('hello')).toBe('hello')
  })

  it('erases the preceding character', () => {
    // "helo\blo" → "hello"
    expect(applyBackspaces('helo\blo')).toBe('hello')
  })

  it('erases multiple characters', () => {
    // "abc\b\b" → "a"
    expect(applyBackspaces('abc\b\b')).toBe('a')
  })

  it('orphan backspace at start of input is silently dropped', () => {
    expect(applyBackspaces('\bhello')).toBe('hello')
  })

  it('does not backspace across newlines', () => {
    // Backspace at start of second line should NOT delete the newline
    expect(applyBackspaces('line1\n\bhello')).toBe('line1\nhello')
  })

  it('handles empty input', () => {
    expect(applyBackspaces('')).toBe('')
  })
})

describe('applyCarriageReturns', () => {
  it('returns input unchanged when no carriage return is present', () => {
    expect(applyCarriageReturns('hello\nworld')).toBe('hello\nworld')
  })

  it('keeps only the content after the last bare CR on a line', () => {
    // "overwritten\rfinal" → "final"
    expect(applyCarriageReturns('overwritten\rfinal')).toBe('final')
  })

  it('handles progress-bar style overwriting with multiple CRs', () => {
    // "10%\r20%\r30%" → "30%"
    expect(applyCarriageReturns('10%\r20%\r30%')).toBe('30%')
  })

  it('does not collapse CRLF line endings', () => {
    // CRLF should remain as a normal newline
    expect(applyCarriageReturns('line1\r\nline2')).toBe('line1\nline2')
  })

  it('handles a CR at the very start of a line', () => {
    expect(applyCarriageReturns('\rcontent')).toBe('content')
  })

  it('handles empty input', () => {
    expect(applyCarriageReturns('')).toBe('')
  })
})

describe('cleanTerminalOutput', () => {
  it('returns empty string for falsy input', () => {
    expect(cleanTerminalOutput('')).toBe('')
  })

  it('strips ANSI, applies backspaces and CRs in combination', () => {
    // ANSI color + CR overwrite + backspace
    const raw = '\x1B[32mgreen\x1B[0m\roverwrite\b!'
    const cleaned = cleanTerminalOutput(raw)
    // ANSI stripped → "green\roverwrite\b!"
    // CR applied:    → "overwrite\b!"
    // Backspace:     → "overwrit!"
    expect(cleaned).toBe('overwrit!')
  })

  it('passes through ordinary multi-line output untouched', () => {
    const plain = 'line1\nline2\nline3'
    expect(cleanTerminalOutput(plain)).toBe(plain)
  })

  it('handles a realistic prompt-like sequence', () => {
    // Shell prompt: "\x1B[32muser@host\x1B[0m:~$ "
    expect(cleanTerminalOutput('\x1B[32muser@host\x1B[0m:~$ ')).toBe('user@host:~$ ')
  })
})
