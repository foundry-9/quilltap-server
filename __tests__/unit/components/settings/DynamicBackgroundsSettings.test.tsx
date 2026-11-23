/**
 * The Dynamic Backgrounds card: master switch, uncensored allowance and the
 * minutes-between-changes input (committed on blur / Enter, clamped 1..120).
 */

import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import {
  DynamicBackgroundsSettings,
  parseRefreshMinutes,
} from '@/components/settings/chat-settings/DynamicBackgroundsSettings'
import type { ChatSettings } from '@/components/settings/chat-settings/types'

type Overrides = { enabled?: boolean; allowUncensored?: boolean; refreshMinutes?: number }

function renderCard(over: Overrides = {}, saving = false) {
  const onChange = jest.fn(async (_u: Record<string, unknown>) => {})
  const settings = {
    id: 'cs-1',
    userId: 'user-1',
    dynamicBackgrounds: { enabled: false, allowUncensored: false, refreshMinutes: 3, ...over },
  } as unknown as ChatSettings
  const utils = render(
    <DynamicBackgroundsSettings settings={settings} saving={saving} onChange={onChange} />,
  )
  return { onChange, ...utils }
}

const minutesInput = () => screen.getByLabelText('Minutes between changes') as HTMLInputElement

describe('parseRefreshMinutes', () => {
  it('parses whole numbers', () => {
    expect(parseRefreshMinutes('5')).toBe(5)
    expect(parseRefreshMinutes('  7 ')).toBe(7)
  })

  it('clamps into 1..120', () => {
    expect(parseRefreshMinutes('0')).toBe(1)
    expect(parseRefreshMinutes('500')).toBe(120)
    expect(parseRefreshMinutes('120')).toBe(120)
    expect(parseRefreshMinutes('1')).toBe(1)
  })

  it('returns null for anything that is not a whole number', () => {
    expect(parseRefreshMinutes('')).toBeNull()
    expect(parseRefreshMinutes('abc')).toBeNull()
    expect(parseRefreshMinutes('2.5')).toBeNull()
    expect(parseRefreshMinutes('-3')).toBeNull()
  })
})

describe('DynamicBackgroundsSettings', () => {
  it('hides the sub-controls while off', () => {
    renderCard({ enabled: false })
    expect((screen.getByLabelText('Dynamic backgrounds') as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByLabelText('Allow uncensored images')).toBeNull()
    expect(screen.queryByLabelText('Minutes between changes')).toBeNull()
  })

  it('shows the sub-controls while on, with their stored values', () => {
    renderCard({ enabled: true, allowUncensored: true, refreshMinutes: 9 })
    expect((screen.getByLabelText('Dynamic backgrounds') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Allow uncensored images') as HTMLInputElement).checked).toBe(true)
    expect(minutesInput().value).toBe('9')
  })

  it('reports the master switch', () => {
    const { onChange } = renderCard({ enabled: false })
    fireEvent.click(screen.getByLabelText('Dynamic backgrounds'))
    expect(onChange).toHaveBeenCalledWith({ enabled: true })
  })

  it('reports the uncensored allowance', () => {
    const { onChange } = renderCard({ enabled: true, allowUncensored: false })
    fireEvent.click(screen.getByLabelText('Allow uncensored images'))
    expect(onChange).toHaveBeenCalledWith({ allowUncensored: true })
  })

  it('does not report minutes while typing, only on blur', () => {
    const { onChange } = renderCard({ enabled: true })
    fireEvent.change(minutesInput(), { target: { value: '10' } })
    expect(minutesInput().value).toBe('10')
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.blur(minutesInput())
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ refreshMinutes: 10 })
  })

  it('commits on Enter', () => {
    const { onChange } = renderCard({ enabled: true })
    fireEvent.change(minutesInput(), { target: { value: '15' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(minutesInput(), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith({ refreshMinutes: 15 })
  })

  it('clamps a large value to 120 and shows the clamped number', () => {
    const { onChange } = renderCard({ enabled: true })
    fireEvent.change(minutesInput(), { target: { value: '999' } })
    fireEvent.blur(minutesInput())
    expect(onChange).toHaveBeenCalledWith({ refreshMinutes: 120 })
    expect(minutesInput().value).toBe('120')
  })

  it('clamps zero up to 1', () => {
    const { onChange } = renderCard({ enabled: true })
    fireEvent.change(minutesInput(), { target: { value: '0' } })
    fireEvent.blur(minutesInput())
    expect(onChange).toHaveBeenCalledWith({ refreshMinutes: 1 })
    expect(minutesInput().value).toBe('1')
  })

  it('reverts a non-numeric value without reporting', () => {
    const { onChange } = renderCard({ enabled: true, refreshMinutes: 4 })
    fireEvent.change(minutesInput(), { target: { value: '' } })
    fireEvent.blur(minutesInput())
    expect(onChange).not.toHaveBeenCalled()
    expect(minutesInput().value).toBe('4')
  })

  it('does not report an unchanged value', () => {
    const { onChange } = renderCard({ enabled: true, refreshMinutes: 6 })
    fireEvent.change(minutesInput(), { target: { value: '6' } })
    fireEvent.blur(minutesInput())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not report a value that clamps to the stored one', () => {
    const { onChange } = renderCard({ enabled: true, refreshMinutes: 120 })
    fireEvent.change(minutesInput(), { target: { value: '300' } })
    fireEvent.blur(minutesInput())
    expect(onChange).not.toHaveBeenCalled()
    expect(minutesInput().value).toBe('120')
  })

  it('disables every control while saving', () => {
    renderCard({ enabled: true }, true)
    expect((screen.getByLabelText('Dynamic backgrounds') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('Allow uncensored images') as HTMLInputElement).disabled).toBe(true)
    expect(minutesInput().disabled).toBe(true)
  })
})
