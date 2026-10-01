/**
 * Content test for the shipped Sample Prompts in the default-system-prompts
 * plugin — the first test that reads the `.md` files themselves.
 *
 * Locks in the anti-committee safeguards
 * (docs/developer/features/prompt-trust-and-anti-committee.md §6): every
 * prompt carries the universal "whose story it is" rules and the committee
 * failure mode; every prompt but the relationship-neutral MODERN_GENERAL
 * carries the trust disposition; and no existing "disagree and hold" line
 * was deleted to make room — the safeguards are a counterweight, not a cut.
 */

import fs from 'fs'
import path from 'path'

const PROMPTS_DIR = path.join(
  process.cwd(),
  'plugins/dist/qtap-plugin-default-system-prompts/prompts',
)

const files = fs.readdirSync(PROMPTS_DIR).filter(f => f.endsWith('.md')).sort()
const read = (file: string) => fs.readFileSync(path.join(PROMPTS_DIR, file), 'utf8')

/** Built from halves so the repository's spelling sweep never sees it. */
const MISSPELLED_PROJECT_NAME = new RegExp('quilt' + 'tap', 'i')

/** Existing disagree lines that must survive (spec §4.1, §6.4). */
const PRESERVED_DISAGREE_LINES: Record<string, string> = {
  'MODERN_GENERAL.md': 'A character who always yields is nobody',
  'MODERN_PLATONIC.md': 'loyalty without honesty is flattery',
  'MODERN_ROMANTIC.md': 'Endless agreement is not love',
  'CLAUDE_COMPANION.md': 'say the plan is bad',
  'CLAUDE_ROMANTIC.md': 'a partner with none is furniture',
  'DEEPSEEK_COMPANION.md': 'hold the position',
  'GEMINI_COMPANION.md': 'hold a position under pressure',
  'GPT5_COMPANION.md': 'hold the position under pushback',
  'GPT4O_COMPANION.md': 'hold them when pushed',
  'GROK_COMPANION.md': 'you hold the position',
  'MISTRAL_COMPANION.md': 'hold it when you mean it',
  'GENERIC_COMPANION.md': 'NEVER be relentlessly positive',
  'OLLAMA_COMPANION.md': 'keep them when challenged',
}

describe('default-system-prompts shipped text', () => {
  it('ships all 21 sample prompts', () => {
    expect(files).toHaveLength(21)
  })

  describe.each(files)('%s', file => {
    const text = read(file)

    it('treats what {{user}} narrates as what happened', () => {
      expect(text).toMatch(/\{\{user\}\}[^.\n]{0,40}narrat/)
    })

    it('requires consent in plain words', () => {
      expect(text).toContain('plain words')
    })

    it('names the committee failure mode', () => {
      expect(text).toMatch(/committee|sign-offs/)
    })

    it('carries the trust disposition unless it is the relationship-neutral MODERN_GENERAL', () => {
      if (file === 'MODERN_GENERAL.md') {
        expect(text).not.toContain('starting point')
      } else {
        expect(text).toContain('starting point')
      }
    })

    it('does not hard-code an out-of-character marking', () => {
      expect(text).not.toContain('((')
    })

    it('spells the project name correctly', () => {
      expect(text).not.toMatch(MISSPELLED_PROJECT_NAME)
    })
  })

  it.each(Object.entries(PRESERVED_DISAGREE_LINES))('%s keeps its disagree line', (file, phrase) => {
    expect(read(file)).toContain(phrase)
  })
})
