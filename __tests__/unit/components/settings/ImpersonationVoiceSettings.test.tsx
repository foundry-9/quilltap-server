/**
 * The Composer card's "Impersonated lines in the character's own words" mode.
 *
 * Off by default matters here: a row that defaulted otherwise would quietly
 * open a dialog on every impersonated line on a fresh instance.
 */

import { describe, it, expect, jest as jestGlobal } from '@jest/globals'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { ImpersonationVoiceSettings } from '@/components/settings/chat-settings/ImpersonationVoiceSettings'
import type { ChatSettings } from '@/components/settings/chat-settings/types'

function renderRow(
  settings: Partial<ChatSettings> = {},
  over: { saving?: boolean } = {},
) {
  const onChange = jestGlobal.fn(async () => {})
  render(
    <ImpersonationVoiceSettings
      settings={{ id: 'cs-1', userId: 'user-1', ...settings } as ChatSettings}
      saving={over.saving ?? false}
      onChange={onChange as never}
    />,
  )
  const radio = (label: string) => screen.getByRole('radio', { name: new RegExp(label) }) as HTMLInputElement
  return { onChange, radio }
}

describe('ImpersonationVoiceSettings', () => {
  it('selects Never when the field has never been set', () => {
    const { radio } = renderRow()
    expect(radio('Never').checked).toBe(true)
    expect(radio('Ask each time').checked).toBe(false)
    expect(radio('Always restate').checked).toBe(false)
  })

  it('reflects a stored ask', () => {
    expect(renderRow({ impersonationVoiceMode: 'ask' }).radio('Ask each time').checked).toBe(true)
  })

  it('reflects a stored always', () => {
    expect(renderRow({ impersonationVoiceMode: 'always' }).radio('Always restate').checked).toBe(true)
  })

  it('reports the chosen mode', () => {
    const { onChange, radio } = renderRow({ impersonationVoiceMode: 'off' })
    fireEvent.click(radio('Ask each time'))
    expect(onChange).toHaveBeenCalledWith('ask')
    fireEvent.click(radio('Always restate'))
    expect(onChange).toHaveBeenCalledWith('always')
  })

  it('is disabled while a save is in flight', () => {
    const { radio } = renderRow({ impersonationVoiceMode: 'off' }, { saving: true })
    expect(radio('Ask each time').disabled).toBe(true)
  })

  it('names the Impersonate button as the trigger and says what is left alone', () => {
    renderRow()
    expect(screen.getByText(/Impersonate button/)).toBeTruthy()
    expect(screen.getByText(/Speaking as yourself is untouched/)).toBeTruthy()
  })
})
