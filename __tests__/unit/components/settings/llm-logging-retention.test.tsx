/**
 * LLM log retention saves on commit (blur or Enter), not per keystroke:
 * typing "60" over "30" used to save 6 first, and an emptied field saved 0,
 * which means unlimited retention.
 */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { LLMLoggingSettingsComponent } from '@/components/settings/chat-settings/LLMLoggingSettings'
import type { ChatSettings } from '@/components/settings/chat-settings/types'

function setup(retentionDays = 30) {
  const onChange = jest.fn().mockResolvedValue(undefined)
  const settings = { llmLoggingSettings: { enabled: true, verboseMode: false, retentionDays } } as unknown as ChatSettings
  const utils = render(<LLMLoggingSettingsComponent settings={settings} saving={false} onLLMLoggingChange={onChange} />)
  const input = screen.getByLabelText('Log retention in days') as HTMLInputElement
  return { onChange, input, ...utils }
}

describe('LLM log retention field', () => {
  it('does not save while typing; saves the whole number on blur', () => {
    const { onChange, input } = setup()
    fireEvent.change(input, { target: { value: '6' } })
    fireEvent.change(input, { target: { value: '60' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('retentionDays', 60)
  })

  it('treats an emptied field as no change, not 0 (unlimited)', () => {
    const { onChange, input } = setup()
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()
    expect(input.value).toBe('30')
  })

  it('saves on Enter and clamps to the allowed range', () => {
    const { onChange, input } = setup()
    fireEvent.change(input, { target: { value: '900' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('retentionDays', 365)
  })

  it('an explicit 0 is still saved', () => {
    const { onChange, input } = setup()
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.blur(input)
    expect(onChange).toHaveBeenCalledWith('retentionDays', 0)
  })
})
