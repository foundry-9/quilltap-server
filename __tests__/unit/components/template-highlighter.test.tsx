import { render, screen } from '@testing-library/react'
import { TemplateDisplay } from '@/components/characters/TemplateHighlighter'

describe('TemplateDisplay', () => {
  it('replaces template variables with character and persona names', () => {
    render(
      <TemplateDisplay
        content="Greetings {{char}}, please help {{user}} today."
        characterName="Alice"
        personaName="Bob"
      />
    )

    const charSpan = screen.getByTitle('Character name (from {{char}})')
    expect(charSpan).toHaveTextContent('Alice')

    const userSpan = screen.getByTitle('Persona name (from {{user}})')
    expect(userSpan).toHaveTextContent('Bob')
  })

  it('falls back to USER label when no persona is provided', () => {
    render(
      <TemplateDisplay
        content="Reminder: {{user}} should stay in character."
        characterName="Alice"
        personaName={null}
      />
    )

    const fallbackSpan = screen.getByTitle('User (no default persona set)')
    expect(fallbackSpan).toHaveTextContent('USER')
  })

  it('warns about hard-coded names that should be converted to templates', () => {
    render(
      <TemplateDisplay
        content="Alice talks to Bob without templates."
        characterName="Alice"
        personaName="Bob"
      />
    )

    const charWarning = screen.getByTitle('Hard-coded character name - consider replacing with {{char}}')
    expect(charWarning).toHaveTextContent('Alice')

    const userWarning = screen.getByTitle('Hard-coded persona name - consider replacing with {{user}}')
    expect(userWarning).toHaveTextContent('Bob')
  })
})
