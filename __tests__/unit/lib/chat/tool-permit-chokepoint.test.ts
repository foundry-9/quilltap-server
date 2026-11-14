/**
 * The tool permit fence.
 *
 * Every tool call is admitted by `resolveToolPermit` (`lib/tools/effects.ts`),
 * asked once at the top of `executeToolCallWithContext`: the tool must be in
 * the seat's offer for this turn, on the right surface, and within the turn's
 * effect ceiling. The offer travels on the tool context (`toolOffer`), so the
 * fence holds three things:
 *
 *  1. the executor asks the permit, and keeps no surface gate of its own;
 *  2. only the sanctioned entry points call the executor;
 *  3. every module that builds a tool context for a loop (or for the
 *     operator's Run Tool) sets `toolOffer` on it — a context without one is
 *     refused at run time, so a missing offer shows up here first.
 *
 * @jest-environment node
 */

import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const SCAN_DIRS = ['lib', 'app']
const EXECUTOR = 'lib/chat/tool-executor.ts'

/** The only callers of `executeToolCallWithContext`. */
const EXECUTOR_CALLERS = new Set([
  // Every model-driven loop dispatches through `processToolCalls`.
  'lib/services/chat-message/tool-execution.service.ts',
  // The operator's Run Tool (`OPERATOR_TOOL_OFFER`).
  'app/api/v1/chats/[id]/actions/run-tool.ts',
])

/**
 * Loops that receive a tool context from their caller and pass it through
 * unchanged; the caller is the one held to setting the offer.
 */
const PASS_THROUGH = new Set([
  'lib/services/chat-message/tool-execution.service.ts',
  'lib/services/chat-message/native-tool-loop.service.ts',
  'lib/services/chat-message/text-tool-loop.service.ts',
  'lib/services/agent-loop/one-shot-loop.ts',
])

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
}

function sourceFiles(): Array<{ rel: string; text: string }> {
  const files: string[] = []
  for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir), files)
  return files.map((file) => {
    const rel = path.relative(ROOT, file).split(path.sep).join('/')
    return { rel, text: fs.readFileSync(file, 'utf8') }
  })
}

/** Strip line and block comments so a mention in prose never counts as a call. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('tool permit chokepoint', () => {
  const files = sourceFiles()

  it('the executor asks the permit and keeps no surface gate of its own', () => {
    const executor = code(fs.readFileSync(path.join(ROOT, EXECUTOR), 'utf8'))
    expect(executor).toMatch(/resolveToolPermit\(/)
    expect(executor).not.toMatch(/!context\.operatorSurface\)/)
    expect(executor).not.toMatch(/isWithinCeiling\(/)
  })

  it('only the sanctioned entry points call the executor', () => {
    const callers = files
      .filter(({ rel, text }) => rel !== EXECUTOR && /executeToolCallWithContext\(/.test(code(text)))
      .map(({ rel }) => rel)
    expect(callers.sort()).toEqual([...EXECUTOR_CALLERS].sort())
  })

  it('every module that builds a tool context for a loop sets its offer', () => {
    const builders = files.filter(({ rel, text }) => {
      if (rel === EXECUTOR || PASS_THROUGH.has(rel)) return false
      const body = code(text)
      const runsTools =
        /\bprocessToolCalls\(/.test(body) ||
        /\brunOneShotToolLoop\(/.test(body) ||
        /\bexecuteToolCallWithContext\(/.test(body) ||
        /\bbuildTurnToolContext\(/.test(body)
      const buildsContext = /:\s*ToolExecutionContext\s*=\s*\{/.test(body) || /\bcreateToolContext\(/.test(body)
      return runsTools || buildsContext
    })
    // Sanity: the known loops are all found.
    const found = builders.map(({ rel }) => rel)
    for (const known of [
      'lib/services/carina/carina.service.ts',
      'lib/services/help-chat/orchestrator.service.ts',
      'lib/services/brahma-console/orchestrator.service.ts',
      'lib/services/brahma-console/one-shot.service.ts',
      'lib/services/scenario-builder/scenario-builder.service.ts',
      'lib/services/chat-message/turn-tools.service.ts',
      'app/api/v1/chats/[id]/actions/run-tool.ts',
    ]) {
      expect(found).toContain(known)
    }
    const missing = builders
      .filter(({ rel, text }) => {
        // The Salon orchestrator gets its context from `buildTurnToolContext`,
        // which sets the offer from the turn's slate.
        if (rel === 'lib/services/chat-message/orchestrator.service.ts') return false
        return !/\btoolOffer\b/.test(code(text))
      })
      .map(({ rel }) => rel)
    expect(missing).toEqual([])
  })

  it('the Salon turn context takes its offer from the slate', () => {
    const turnTools = code(fs.readFileSync(path.join(ROOT, 'lib/services/chat-message/turn-tools.service.ts'), 'utf8'))
    expect(turnTools).toMatch(/toolContext\.toolOffer\s*=\s*slate\.toolOffer/)
  })
})
