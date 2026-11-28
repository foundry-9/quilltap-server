/**
 * The Context Compression sliders save from the keyboard as well as the
 * mouse (#259): an arrow key's change is shown at once and committed on key
 * release, and a failed save snaps the slider back to the stored value.
 */

import React from 'react'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { ContextCompressionSettingsComponent } from '@/components/settings/chat-settings/ContextCompressionSettings'
import {
  DEFAULT_CONTEXT_COMPRESSION_SETTINGS,
  type ChatSettings,
} from '@/components/settings/chat-settings/types'

function settingsWith(overrides: Partial<typeof DEFAULT_CONTEXT_COMPRESSION_SETTINGS> = {}): ChatSettings {
  return {
    contextCompressionSettings: {
      ...DEFAULT_CONTEXT_COMPRESSION_SETTINGS,
      enabled: true,
      windowSize: 5,
      compressionTargetTokens: 800,
      projectContextReinjectInterval: 5,
      ...overrides,
    },
  } as unknown as ChatSettings
}

function pressArrow(slider: HTMLElement, nextValue: string) {
  slider.focus()
  fireEvent.keyDown(slider, { key: 'ArrowRight' })
  fireEvent.change(slider, { target: { value: nextValue } })
  fireEvent.keyUp(slider, { key: 'ArrowRight' })
}

describe('ContextCompressionSettingsComponent sliders', () => {
  it('commits the sliding window size from the keyboard, raising the re-injection interval with it', async () => {
    const onUpdate = jest.fn().mockResolvedValue(undefined)
    render(<ContextCompressionSettingsComponent settings={settingsWith()} saving={false} onUpdate={onUpdate} />)

    const slider = screen.getByLabelText(/Sliding Window Size/)
    act(() => pressArrow(slider, '6'))

    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith({ windowSize: 6, projectContextReinjectInterval: 6 })
    // The committed value stays on screen while the save is in flight.
    expect(slider).toHaveValue('6')
  })

  it('commits the history compression target from the keyboard', () => {
    const onUpdate = jest.fn().mockResolvedValue(undefined)
    render(<ContextCompressionSettingsComponent settings={settingsWith()} saving={false} onUpdate={onUpdate} />)

    const slider = screen.getByLabelText(/History Compression Target/)
    act(() => pressArrow(slider, '900'))

    expect(onUpdate).toHaveBeenCalledWith({ compressionTargetTokens: 900 })
  })

  it('commits the project context interval on blur', () => {
    const onUpdate = jest.fn().mockResolvedValue(undefined)
    render(<ContextCompressionSettingsComponent settings={settingsWith()} saving={false} onUpdate={onUpdate} />)

    const slider = screen.getByLabelText(/Project Context Re-injection/)
    act(() => {
      slider.focus()
      fireEvent.change(slider, { target: { value: '8' } })
    })
    expect(onUpdate).not.toHaveBeenCalled()
    expect(slider).toHaveValue('8')

    act(() => slider.blur())
    expect(onUpdate).toHaveBeenCalledWith({ projectContextReinjectInterval: 8 })
  })

  it('snaps back to the stored value when the save settles without it', async () => {
    const onUpdate = jest.fn().mockRejectedValue(new Error('nope'))
    render(<ContextCompressionSettingsComponent settings={settingsWith()} saving={false} onUpdate={onUpdate} />)

    const slider = screen.getByLabelText(/History Compression Target/)
    act(() => pressArrow(slider, '1000'))

    await waitFor(() => expect(slider).toHaveValue('800'))
  })

  it('does not save when the value did not change', () => {
    const onUpdate = jest.fn().mockResolvedValue(undefined)
    render(<ContextCompressionSettingsComponent settings={settingsWith()} saving={false} onUpdate={onUpdate} />)

    const slider = screen.getByLabelText(/Sliding Window Size/)
    act(() => {
      fireEvent.keyUp(slider, { key: 'Tab' })
      fireEvent.blur(slider)
    })
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
