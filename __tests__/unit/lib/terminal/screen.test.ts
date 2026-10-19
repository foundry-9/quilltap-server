/**
 * @jest-environment node
 */

import { TerminalScreen, renderTranscript } from '@/lib/terminal/screen'

const ESC = '\x1B'

describe('TerminalScreen', () => {
  let screen: TerminalScreen

  afterEach(() => {
    screen?.dispose()
  })

  it('renders a plain shell as scrollback lines', async () => {
    screen = new TerminalScreen(40, 5)
    screen.write('$ echo hi\r\nhi\r\n$ ')
    const r = await screen.render()
    expect(r.buffer).toBe('normal')
    expect(r.lines).toEqual(['$ echo hi', 'hi', '$'])
  })

  it('keeps lines that scrolled off the visible rows', async () => {
    screen = new TerminalScreen(40, 3)
    screen.write(['one', 'two', 'three', 'four', 'five'].join('\r\n'))
    const r = await screen.render()
    expect(r.lines).toEqual(['one', 'two', 'three', 'four', 'five'])
  })

  it('applies cursor addressing the way a full-screen program draws (bug 255)', async () => {
    screen = new TerminalScreen(40, 6)
    // Alternate screen, absolute moves, and cursor-right in place of spaces —
    // the shape of Claude Code's output, which stripping reduced to fragments.
    screen.write(`${ESC}[?1049h${ESC}[H${ESC}[2J`)
    screen.write(`${ESC}[1;1HHello${ESC}[1Cworld`)
    screen.write(`${ESC}[3;3H${ESC}[38;5;174m⏺${ESC}[39m Fixing it.`)
    screen.write(`${ESC}[5;1Hstale${ESC}[5;1H${ESC}[Kfresh`)
    const r = await screen.render()
    expect(r.buffer).toBe('alternate')
    expect(r.lines).toEqual(['Hello world', '', '  ⏺ Fixing it.', '', 'fresh'])
  })

  it('joins soft-wrapped rows back into one line', async () => {
    screen = new TerminalScreen(10, 5)
    screen.write('abcdefghijKLMNO\r\nnext')
    const r = await screen.render()
    expect(r.lines).toEqual(['abcdefghijKLMNO', 'next'])
  })

  it('follows a resize', async () => {
    screen = new TerminalScreen(80, 24)
    screen.resize(100, 30)
    const r = await screen.render()
    expect(r.cols).toBe(100)
    expect(r.rows).toBe(30)
  })

  describe('takeSummary', () => {
    it('returns shell output since the previous summary, without repeating its last line', async () => {
      screen = new TerminalScreen(40, 10)
      screen.write('$ ls\r\na.txt\r\n$ ')
      expect(await screen.takeSummary()).toEqual({ kind: 'output', text: '$ ls\na.txt\n$' })

      screen.write('pwd\r\n/tmp\r\n$ ')
      expect(await screen.takeSummary()).toEqual({ kind: 'output', text: '$ pwd\n/tmp\n$' })
    })

    it('returns null when nothing new was written', async () => {
      screen = new TerminalScreen(40, 10)
      screen.write('$ ')
      await screen.takeSummary()
      expect(await screen.takeSummary()).toBeNull()
    })

    it('snapshots a full-screen program, skipping an unchanged screen', async () => {
      screen = new TerminalScreen(40, 4)
      screen.write(`${ESC}[?1049h${ESC}[H${ESC}[2JClaude${ESC}[2;1H> prompt`)
      expect(await screen.takeSummary()).toEqual({ kind: 'screen', text: 'Claude\n> prompt' })

      // A cursor blink repaints nothing visible.
      screen.write(`${ESC}[?25l${ESC}[?25h`)
      expect(await screen.takeSummary()).toBeNull()

      screen.write(`${ESC}[2;3Hdone  `)
      expect(await screen.takeSummary()).toEqual({ kind: 'screen', text: 'Claude\n> done' })
    })

    it('returns to shell output when the program leaves the alternate screen', async () => {
      screen = new TerminalScreen(40, 6)
      screen.write('$ ')
      await screen.takeSummary()
      screen.write(`claude\r\n${ESC}[?1049h${ESC}[HTUI${ESC}[?1049l$ `)
      const summary = await screen.takeSummary()
      expect(summary?.kind).toBe('output')
      expect(summary?.text).toContain('$ claude')
      expect(summary?.text).not.toContain('TUI')
    })
  })
})

describe('renderTranscript', () => {
  it('replays a recorded stream at the given geometry', async () => {
    const r = await renderTranscript(`${ESC}[?1049h${ESC}[H${ESC}[2Jtop${ESC}[3;2Hbottom`, 20, 4)
    expect(r).toEqual({ buffer: 'alternate', lines: ['top', '', ' bottom'], cols: 20, rows: 4 })
  })
})
