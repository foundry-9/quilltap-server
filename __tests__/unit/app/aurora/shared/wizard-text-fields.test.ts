import { buildWizardCurrentData, getGeneratedCharacterTextEntries } from '@/app/aurora/shared/wizard-text-fields'

describe('aurora wizard text field helpers', () => {
  it('collects all non-empty generated text fields including identity and manifesto', () => {
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
      { field: 'systemPrompt', value: 'Stay in character.' },
    ])
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
