/**
 * The Composer card's "Impersonated lines in the character's own words" toggle.
 *
 * Off by default matters here: this is the one Composer toggle the factory
 * leaves unchecked, and a row that defaulted the other way would quietly
 * rehearse every impersonated line on a fresh instance.
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
  return { onChange, checkbox: screen.getByRole('checkbox') as HTMLInputElement }
}

describe('ImpersonationVoiceSettings', () => {
  it('is unchecked when the field has never been set', () => {
    const { checkbox } = renderRow()
    expect(checkbox.checked).toBe(false)
  })

  it('reflects a stored true', () => {
    expect(renderRow({ impersonationVoiceRewrite: true }).checkbox.checked).toBe(true)
  })

  it('reflects a stored false', () => {
    expect(renderRow({ impersonationVoiceRewrite: false }).checkbox.checked).toBe(false)
  })

  it('reports the new value when ticked', () => {
    const { onChange, checkbox } = renderRow({ impersonationVoiceRewrite: false })
    fireEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('reports the new value when unticked', () => {
    const { onChange, checkbox } = renderRow({ impersonationVoiceRewrite: true })
    fireEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('is disabled while a save is in flight', () => {
    const { checkbox } = renderRow({ impersonationVoiceRewrite: false }, { saving: true })
    expect(checkbox.disabled).toBe(true)
  })

  it('names the Impersonate button as the trigger and says what is left alone', () => {
    renderRow()
    expect(screen.getByText(/Impersonate button/)).toBeTruthy()
    expect(screen.getByText(/Speaking as yourself is untouched/)).toBeTruthy()
  })
})
