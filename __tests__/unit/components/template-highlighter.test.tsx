import { render, screen } from '@testing-library/react'
import {
  TemplateDisplay,
  collectTemplateFields,
  applyTemplateTransform,
  replaceTemplateWithName,
  replaceWithTemplate,
  countTemplateLiterals,
  type TemplatableCharacter,
} from '@/components/characters/TemplateHighlighter'

function makeCharacter(overrides: Partial<TemplatableCharacter> = {}): TemplatableCharacter {
  return {
    name: 'Alice',
    identity: 'Alice is a known traveler.',
    manifesto: 'Alice protects the weak.',
    description: 'Alice speaks softly.',
    personality: 'Curious.',
    firstMessage: 'Hello from Alice.',
    exampleDialogues: 'Alice: hi',
    scenarios: [
      { id: 's1', content: 'Alice meets Bob.' },
      { id: 's2', content: 'A quiet morning.' },
    ],
    systemPrompts: [
      { id: 'p1', content: 'You are Alice.' },
      { id: 'p2', content: 'Stay in character.' },
    ],
    physicalDescription: {
      id: 'pd1',
      name: 'Appearance',
      fullDescription: 'Alice has red hair.',
      shortPrompt: 'red hair',
      mediumPrompt: null,
      longPrompt: null,
      completePrompt: null,
    },
    ...overrides,
  }
}

describe('collectTemplateFields', () => {
  it('includes identity and manifesto as scalar fields', () => {
    const fields = collectTemplateFields(makeCharacter())
    const scalarKeys = fields.filter((f) => f.kind === 'scalar').map((f) => f.key)
    expect(scalarKeys).toContain('identity')
    expect(scalarKeys).toContain('manifesto')
  })

  it('excludes title and the physical-description name', () => {
    const fields = collectTemplateFields(makeCharacter({ title: 'the rival' } as Partial<TemplatableCharacter>))
    const keys = fields.map((f) => f.key)
    expect(keys).not.toContain('title')
    // physical descriptors only cover the five prose/prompt sub-fields, never `name`
    const physicalSubs = fields.filter((f) => f.kind === 'physical').map((f) => (f.kind === 'physical' ? f.sub : ''))
    expect(physicalSubs).not.toContain('name')
    expect(physicalSubs).toEqual([
      'fullDescription',
      'shortPrompt',
      'mediumPrompt',
      'longPrompt',
      'completePrompt',
    ])
  })

  it('emits one descriptor per scenario and per system prompt', () => {
    const fields = collectTemplateFields(makeCharacter())
    expect(fields.filter((f) => f.kind === 'scenario').map((f) => f.key)).toEqual([
      'scenario:s1',
      'scenario:s2',
    ])
    expect(fields.filter((f) => f.kind === 'systemPrompt').map((f) => f.key)).toEqual([
      'systemPrompt:p1',
      'systemPrompt:p2',
    ])
  })

  it('handles a sparse character without throwing', () => {
    const fields = collectTemplateFields({ name: 'Zed' })
    // Six scalar slots always emitted; no scenarios/prompts/physical.
    expect(fields.filter((f) => f.kind === 'scalar')).toHaveLength(6)
    expect(fields.filter((f) => f.kind !== 'scalar')).toHaveLength(0)
  })
})

describe('replaceTemplateWithName', () => {
  it('replaces {{char}} case-insensitively', () => {
    expect(replaceTemplateWithName('Hi {{char}}, {{Char}}, {{CHAR}}', 'char', 'Alice')).toBe(
      'Hi Alice, Alice, Alice'
    )
  })

  it('leaves {{user}} alone when targeting char', () => {
    expect(replaceTemplateWithName('{{char}} and {{user}}', 'char', 'Alice')).toBe(
      'Alice and {{user}}'
    )
  })

  it('inserts a name containing $ literally (no replacement-pattern mangling)', () => {
    expect(replaceTemplateWithName('hey {{user}}', 'user', 'A$AP')).toBe('hey A$AP')
    expect(replaceTemplateWithName('hey {{user}}', 'user', '$&!')).toBe('hey $&!')
  })

  it('inserts a name containing regex metacharacters literally', () => {
    expect(replaceTemplateWithName('{{user}}', 'user', 'Dr. (Bob)')).toBe('Dr. (Bob)')
  })
})

describe('countTemplateLiterals', () => {
  it('counts mixed-case {{char}}/{{user}} literals across values', () => {
    expect(
      countTemplateLiterals(['{{char}} {{Char}}', null, 'x {{USER}} y {{user}}', undefined])
    ).toEqual({ charCount: 2, userCount: 2 })
  })

  it('returns zero counts when no literals present', () => {
    expect(countTemplateLiterals(['just text', 'Alice and Bob'])).toEqual({
      charCount: 0,
      userCount: 0,
    })
  })
})

describe('applyTemplateTransform', () => {
  it('forward: routes system prompts separately and merges scenarios/physical', () => {
    const character = makeCharacter()
    const { mainUpdates, changedSystemPrompts } = applyTemplateTransform(character, (t) =>
      replaceWithTemplate(t, 'Alice', '{{char}}')
    )

    // Scalars carrying "Alice" are templatized; "personality" (no Alice) is omitted.
    expect(mainUpdates.identity).toBe('{{char}} is a known traveler.')
    expect(mainUpdates.manifesto).toBe('{{char}} protects the weak.')
    expect(mainUpdates.description).toBe('{{char}} speaks softly.')
    expect(mainUpdates.firstMessage).toBe('Hello from {{char}}.')
    expect(mainUpdates).not.toHaveProperty('personality')

    // Scenarios: full array sent, only the changed one rewritten.
    expect(mainUpdates.scenarios).toEqual([
      { id: 's1', content: '{{char}} meets Bob.' },
      { id: 's2', content: 'A quiet morning.' },
    ])

    // Physical: merged object, name preserved, only changed prose rewritten.
    expect(mainUpdates.physicalDescription).toMatchObject({
      id: 'pd1',
      name: 'Appearance',
      fullDescription: '{{char}} has red hair.',
      shortPrompt: 'red hair',
    })

    // System prompts go to the dedicated channel, not the PUT body.
    expect(mainUpdates).not.toHaveProperty('systemPrompts')
    expect(changedSystemPrompts).toEqual([{ id: 'p1', content: 'You are {{char}}.' }])
  })

  it('reverse: restores {{user}} to a chosen name across all field kinds', () => {
    const character = makeCharacter({
      identity: 'Greets {{user}} warmly.',
      systemPrompts: [{ id: 'p1', content: 'Address {{user}} politely.' }],
      scenarios: [{ id: 's1', content: '{{user}} arrives.' }],
      physicalDescription: null,
    })
    const { mainUpdates, changedSystemPrompts } = applyTemplateTransform(character, (t) =>
      replaceTemplateWithName(t, 'user', 'Bob')
    )
    expect(mainUpdates.identity).toBe('Greets Bob warmly.')
    expect(mainUpdates.scenarios).toEqual([{ id: 's1', content: 'Bob arrives.' }])
    expect(changedSystemPrompts).toEqual([{ id: 'p1', content: 'Address Bob politely.' }])
  })

  it('falls back the physical name to "Appearance" when empty, never transforming name', () => {
    const character = makeCharacter({
      physicalDescription: {
        id: 'pd1',
        name: '   ',
        fullDescription: 'Alice stands tall.',
      },
    })
    const { mainUpdates } = applyTemplateTransform(character, (t) =>
      replaceWithTemplate(t, 'Alice', '{{char}}')
    )
    expect(mainUpdates.physicalDescription).toMatchObject({
      name: 'Appearance',
      fullDescription: '{{char}} stands tall.',
    })
  })

  it('emits nothing when no field contains the target name', () => {
    const { mainUpdates, changedSystemPrompts } = applyTemplateTransform(
      makeCharacter(),
      (t) => replaceWithTemplate(t, 'Nonexistent', '{{char}}')
    )
    expect(Object.keys(mainUpdates)).toHaveLength(0)
    expect(changedSystemPrompts).toHaveLength(0)
  })
})

describe('count/transform parity (anti-drift guarantee)', () => {
  it('every field key that can be counted is reachable by the transform, and vice versa', () => {
    // Build a character where EVERY templatable slot contains the target name,
    // so the transform must touch every field collectTemplateFields enumerates.
    const character: TemplatableCharacter = {
      name: 'X',
      identity: 'X',
      manifesto: 'X',
      description: 'X',
      personality: 'X',
      firstMessage: 'X',
      exampleDialogues: 'X',
      scenarios: [{ id: 's1', content: 'X' }],
      systemPrompts: [{ id: 'p1', content: 'X' }],
      physicalDescription: {
        id: 'pd1',
        name: 'Appearance',
        fullDescription: 'X',
        shortPrompt: 'X',
        mediumPrompt: 'X',
        longPrompt: 'X',
        completePrompt: 'X',
      },
    }

    const collectedKinds = new Set(collectTemplateFields(character).map((f) => f.kind))
    const { mainUpdates, changedSystemPrompts } = applyTemplateTransform(character, (t) =>
      replaceWithTemplate(t, 'X', '{{char}}')
    )

    // Every kind collectTemplateFields can yield is represented in the output.
    expect(collectedKinds).toEqual(new Set(['scalar', 'scenario', 'systemPrompt', 'physical']))
    expect(mainUpdates).toHaveProperty('identity')
    expect(mainUpdates).toHaveProperty('manifesto')
    expect(mainUpdates).toHaveProperty('scenarios')
    expect(mainUpdates).toHaveProperty('physicalDescription')
    expect(changedSystemPrompts).toHaveLength(1)
  })
})

describe('TemplateDisplay', () => {
  it('replaces template variables with character and persona names', () => {
    render(
      <TemplateDisplay
        content="Greetings {{char}}, please help {{user}} today."
        characterName="Alice"
        userCharacterName="Bob"
      />
    )

    const charSpan = screen.getByTitle('Character name (from {{char}})')
    expect(charSpan).toHaveTextContent('Alice')

    const userSpan = screen.getByTitle('User character name (from {{user}})')
    expect(userSpan).toHaveTextContent('Bob')
  })

  it('falls back to USER label when no persona is provided', () => {
    render(
      <TemplateDisplay
        content="Reminder: {{user}} should stay in character."
        characterName="Alice"
        userCharacterName={null}
      />
    )

    const fallbackSpan = screen.getByTitle('User (no default user character set)')
    expect(fallbackSpan).toHaveTextContent('USER')
  })

  it('warns about hard-coded names that should be converted to templates', () => {
    render(
      <TemplateDisplay
        content="Alice talks to Bob without templates."
        characterName="Alice"
        userCharacterName="Bob"
      />
    )

    const charWarning = screen.getByTitle('Hard-coded character name - consider replacing with {{char}}')
    expect(charWarning).toHaveTextContent('Alice')

    const userWarning = screen.getByTitle('Hard-coded user character name - consider replacing with {{user}}')
    expect(userWarning).toHaveTextContent('Bob')
  })
})
