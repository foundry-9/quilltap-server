/**
 * Content test for the shipped Sample Prompts in the default-system-prompts
 * plugin — the first test that reads the `.md` files themselves.
 *
 * Locks in the anti-committee safeguards
 * (docs/developer/features/complete/prompt-trust-and-anti-committee.md §6): every
 * prompt carries the universal "whose story it is" rules and the committee
 * failure mode; every prompt but the relationship-neutral MODERN_ROLEPLAY and
 * MODERN_ASSISTANT carries the trust disposition; and no existing "disagree
 * and hold" line was deleted to make room — the safeguards are a
 * counterweight, not a cut.
 *
 * And the roleplay defaults (docs/developer/features/character-kind-and-roleplay-defaults.md
 * §5.4): MODERN_ROLEPLAY replaced MODERN_GENERAL, every prompt but the
 * assistant one tells the character to match the stakes, and no shipped
 * prompt tells a character to keep a dangerous scene calm.
 */

import fs from 'fs'
import path from 'path'

const PROMPTS_DIR = path.join(
  process.cwd(),
  'plugins/dist/qtap-plugin-default-system-prompts/prompts',
)

const files = fs.readdirSync(PROMPTS_DIR).filter(f => f.endsWith('.md')).sort()
const read = (file: string) => fs.readFileSync(path.join(PROMPTS_DIR, file), 'utf8')

/** Relationship-neutral prompts: no trust disposition, no ordinary-time yes. */
const NEUTRAL = new Set(['MODERN_ROLEPLAY.md', 'MODERN_ASSISTANT.md'])

/** Built from halves so the repository's spelling sweep never sees it. */
const MISSPELLED_PROJECT_NAME = new RegExp('quilt' + 'tap', 'i')

/** Existing disagree lines that must survive (spec §4.1, §6.4). */
const PRESERVED_DISAGREE_LINES: Record<string, string> = {
  'MODERN_ROLEPLAY.md': 'A character who always yields is nobody',
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
  it('ships all 22 sample prompts', () => {
    expect(files).toHaveLength(22)
  })

  it('ships MODERN_ROLEPLAY and MODERN_ASSISTANT, and has retired MODERN_GENERAL', () => {
    expect(files).toContain('MODERN_ROLEPLAY.md')
    expect(files).toContain('MODERN_ASSISTANT.md')
    expect(files).not.toContain('MODERN_GENERAL.md')
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

    it('carries the trust disposition unless it is relationship-neutral', () => {
      if (NEUTRAL.has(file)) {
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

/**
 * The probation (docs/developer/features/prompt-trust-the-probation.md §7):
 * the "right as readily as they slipped" ledger is gone everywhere, every
 * prompt forbids asserting {{user}}'s interior, and every relationship prompt
 * gives ordinary time a plain yes — the friendship prompt in its softer form.
 */
describe('default-system-prompts shipped text — the probation', () => {
  describe.each(files)('%s', file => {
    const text = read(file)

    it('carries no slips ledger', () => {
      expect(text).not.toMatch(/slipped/i)
    })

    it('forbids telling {{user}} what they really meant', () => {
      expect(text).toMatch(/what they really meant|what \{\{user\}\} really meant/)
    })

    it('gives ordinary time a yes unless it is relationship-neutral', () => {
      if (NEUTRAL.has(file)) {
        expect(text).not.toMatch(/ordinary time/i)
      } else if (file.startsWith('OLLAMA_')) {
        expect(text).toContain('Say yes to ordinary asks')
      } else {
        expect(text).toMatch(/Ordinary time/)
      }
    })
  })

  it('gives the friendship prompt the softer default yes', () => {
    const platonic = read('MODERN_PLATONIC.md')
    expect(platonic).toContain('usually says yes')
    expect(platonic).toContain('plainly and kindly, without terms')
  })

  it('counterweights pushback with how often, not just how', () => {
    expect(read('MODERN_ROLEPLAY.md')).toContain('the no is for things that matter')
    expect(read('MODERN_ROMANTIC.md')).toContain('most of the time, love sounds like yes')
    expect(read('GPT5_COMPANION.md')).not.toContain('Agreeing quickly to be agreeable is a failure')
  })
})

/** Phrases that told a character to keep the story small whatever happened. */
const RETIRED_GOVERNOR_PHRASES = [
  'main failure mode is escalation',
  'stays an annoying Tuesday',
  'No scene swerves into melodrama',
  'Do not escalate intimacy, hostility, or drama',
]

describe('default-system-prompts shipped text — the stakes', () => {
  describe.each(files)('%s', file => {
    const text = read(file)

    it.each(RETIRED_GOVERNOR_PHRASES)('does not carry the retired governor phrase %p', phrase => {
      expect(text).not.toContain(phrase)
    })

    it('tells a story character to match the stakes', () => {
      if (file === 'MODERN_ASSISTANT.md') {
        expect(text).not.toMatch(/match the stakes/i)
      } else {
        expect(text).toMatch(/match the stakes/i)
        expect(text).toMatch(/not a vow/)
      }
    })
  })

  it('gives the roleplay default its stakes, ensemble and failure-mode sections', () => {
    const roleplay = read('MODERN_ROLEPLAY.md')
    expect(roleplay).toContain('## Reacting to what happens')
    expect(roleplay).toContain('## In a scene with others')
    expect(roleplay).toContain('**Flattening:**')
    expect(roleplay).toContain('**The mediator:**')
  })

  it('keeps the assistant honest about what it does not know', () => {
    const assistant = read('MODERN_ASSISTANT.md')
    expect(assistant).toContain('Never invent a fact')
    expect(assistant).toContain('Set the character\'s kind to Assistant')
  })
})
