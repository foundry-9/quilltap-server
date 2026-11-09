import {
  buildWizardCurrentData,
  generatedSystemPrompt,
  getGeneratedCharacterTextEntries,
  systemPromptsForCreate,
} from '@/app/aurora/shared/wizard-text-fields'

describe('aurora wizard text field helpers', () => {
  it('collects the generated character fields, leaving the system prompt out (#146)', () => {
    const entries = getGeneratedCharacterTextEntries({
      name: 'Friday',
      title: 'The investigator',
      identity: 'A famous detective known across the city',
      description: 'Crisp diction and relentless eye contact',
      manifesto: 'Truth before comfort.',
      personality: 'Methodical and curious',
      exampleDialogues: 'Friday: We follow the evidence.',
      systemPrompt: 'Stay in character.',
    })

    expect(entries).toEqual([
      { field: 'name', value: 'Friday' },
      { field: 'title', value: 'The investigator' },
      { field: 'identity', value: 'A famous detective known across the city' },
      { field: 'description', value: 'Crisp diction and relentless eye contact' },
      { field: 'manifesto', value: 'Truth before comfort.' },
      { field: 'personality', value: 'Methodical and curious' },
      { field: 'exampleDialogues', value: 'Friday: We follow the evidence.' },
    ])
  })

  it('hands the generated system prompt over separately, trimmed, and nothing when blank', () => {
    expect(generatedSystemPrompt({ systemPrompt: '  Stay in character.  ' })).toBe('Stay in character.')
    expect(generatedSystemPrompt({ systemPrompt: '   ' })).toBeNull()
    expect(generatedSystemPrompt({})).toBeNull()
  })

  it('folds a create-form system prompt into one named prompt (#146); the server owns its id and default', () => {
    expect(systemPromptsForCreate(' You are Friday. ')).toEqual([{ name: 'Default', content: 'You are Friday.' }])
    expect(systemPromptsForCreate('  ')).toEqual([])
  })

  it('builds wizard current data including identity and manifesto', () => {
    expect(buildWizardCurrentData({
      title: 'The investigator',
      identity: 'A famous detective known across the city',
      description: 'Crisp diction and relentless eye contact',
      manifesto: 'Truth before comfort.',
      personality: 'Methodical and curious',
      exampleDialogues: 'Friday: We follow the evidence.',
      systemPrompt: 'Stay in character.',
    })).toEqual({
      title: 'The investigator',
      identity: 'A famous detective known across the city',
      description: 'Crisp diction and relentless eye contact',
      manifesto: 'Truth before comfort.',
      personality: 'Methodical and curious',
      exampleDialogues: 'Friday: We follow the evidence.',
      systemPrompt: 'Stay in character.',
    })
  })
})
