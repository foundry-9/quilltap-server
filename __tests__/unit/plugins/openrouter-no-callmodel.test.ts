/**
 * #145: @openrouter/sdk 1.5.57 removed `callModel()` and the `lib/chat-compat`
 * subpath (`fromChatMessages`). The OpenRouter plugin now streams over a direct
 * Chat Completions fetch; nothing in the plugin, its mocks or the Jest config
 * may name the removed API again.
 */
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..', '..', '..')
const PLUGIN_DIR = join(ROOT, 'plugins', 'dist', 'qtap-plugin-openrouter')
const MOCK_DIR = join(ROOT, '__mocks__', '@openrouter')
const FORBIDDEN = /callModel|chat-compat|fromChatMessages/

function tsFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(dir, f))
}

describe('OpenRouter plugin does not use the removed SDK agent API (#145)', () => {
  const files = [
    ...tsFiles(PLUGIN_DIR),
    ...tsFiles(MOCK_DIR),
    join(ROOT, 'jest.config.ts'),
  ]

  it.each(files.map((f) => [f.slice(ROOT.length + 1), f]))('%s names none of callModel / chat-compat / fromChatMessages', (_label, file) => {
    const offending = readFileSync(file, 'utf-8')
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => FORBIDDEN.test(line))
      .map(({ line, n }) => `${n}: ${line.trim()}`)
    expect(offending).toEqual([])
  })
})
