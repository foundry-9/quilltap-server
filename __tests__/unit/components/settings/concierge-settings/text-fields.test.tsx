/**
 * #250: the Concierge's typed fields draft locally and save once, when the
 * user lets go, and stay enabled while a save is pending.
 */

import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { RefusalsCard } from '@/components/settings/concierge-settings/RefusalsCard'
import { PreScreeningCard } from '@/components/settings/concierge-settings/PreScreeningCard'
import type { ConciergeSettings } from '@/components/settings/chat-settings/types'

function makeSettings(): ConciergeSettings {
  return {
    autoSwitchAfterRefusals: 3,
    newChatsStartAs: 'moderated',
    preScreen: {
      enabled: true,
      scanTextChat: true,
      scanImagePrompts: false,
      scanImageGeneration: false,
      summaryClassification: false,
      threshold: 0.7,
      customClassificationPrompt: null,
    },
  } as unknown as ConciergeSettings
}

describe('RefusalsCard (#250)', () => {
  it('keeps every keystroke while a save is pending and sends one save on blur', () => {
    const onUpdate = jest.fn().mockResolvedValue(undefined)
    render(<RefusalsCard settings={makeSettings()} saving={true} onUpdate={onUpdate} />)

    const input = screen.getByLabelText(/Switch a chat to Unmoderated/) as HTMLInputElement
    expect(input.disabled).toBe(false)
    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.change(input, { target: { value: '10' } })
    expect(onUpdate).not.toHaveBeenCalled()
    expect(input.value).toBe('10')

    fireEvent.blur(input)
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith({ autoSwitchAfterRefusals: 10 })
  })

  it('reverts a blank entry without saving', () => {
    const onUpdate = jest.fn().mockResolvedValue(undefined)
    render(<RefusalsCard settings={makeSettings()} saving={false} onUpdate={onUpdate} />)
    const input = screen.getByLabelText(/Switch a chat to Unmoderated/) as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(onUpdate).not.toHaveBeenCalled()
    expect(input.value).toBe('3')
  })
})

describe('PreScreeningCard (#250)', () => {
  it('lets a prompt be typed while saving and saves it once on blur', () => {
    const onUpdate = jest.fn().mockResolvedValue(undefined)
    render(<PreScreeningCard settings={makeSettings()} saving={true} onUpdate={onUpdate} />)

    const textarea = screen.getByLabelText(/Custom classification prompt/) as HTMLTextAreaElement
    expect(textarea.disabled).toBe(false)
    textarea.focus()
    fireEvent.change(textarea, { target: { value: 'b' } })
    fireEvent.change(textarea, { target: { value: 'be gentle' } })
    expect(onUpdate).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(textarea)
    expect(textarea.value).toBe('be gentle')

    fireEvent.blur(textarea)
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith({ preScreen: { customClassificationPrompt: 'be gentle' } })
  })

  it('saves the slider once when the pointer is released', () => {
    const onUpdate = jest.fn().mockResolvedValue(undefined)
    render(<PreScreeningCard settings={makeSettings()} saving={false} onUpdate={onUpdate} />)

    const slider = screen.getByLabelText(/Detection threshold/) as HTMLInputElement
    fireEvent.change(slider, { target: { value: '0.5' } })
    fireEvent.change(slider, { target: { value: '0.3' } })
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByText(/Detection threshold \(0\.3\)/)).toBeTruthy()

    fireEvent.pointerUp(slider)
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith({ preScreen: { threshold: 0.3 } })
  })
})
