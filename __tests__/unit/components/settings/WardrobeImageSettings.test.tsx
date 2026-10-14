/**
 * The Images tab's "Wardrobe Images" card: one picker naming the artist who
 * draws garments. Empty means the default image profile (stored as null), and
 * the uncensored desks are marked so the operator can pick one on purpose.
 */

import { describe, it, expect, jest as jestGlobal } from '@jest/globals'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { WardrobeImageSettings } from '@/components/settings/chat-settings/WardrobeImageSettings'
import type { ChatSettings, ImageProfile } from '@/components/settings/chat-settings/types'

const PROFILES: ImageProfile[] = [
  { id: 'p-default', name: 'House Artist', provider: 'OPENAI', modelName: 'gpt-image-1', isDefault: true },
  {
    id: 'p-wild',
    name: 'Back Room',
    provider: 'GROK',
    modelName: 'grok-image',
    isDefault: false,
    isDangerousCompatible: true,
  },
]

function renderCard(
  settings: Partial<ChatSettings> = {},
  over: { saving?: boolean; profiles?: ImageProfile[] } = {},
) {
  const onProfileChange = jestGlobal.fn(async (_id: string | null) => {})
  render(
    <WardrobeImageSettings
      settings={{ id: 'cs-1', userId: 'user-1', ...settings } as ChatSettings}
      saving={over.saving ?? false}
      loadingProfiles={false}
      imageProfiles={over.profiles ?? PROFILES}
      onProfileChange={onProfileChange}
    />,
  )
  const select = screen.getByLabelText('Wardrobe Artist') as HTMLSelectElement
  return { onProfileChange, select }
}

describe('WardrobeImageSettings', () => {
  it('shows the helper copy', () => {
    renderCard()
    expect(screen.getByText(/Which artist draws the garments/)).toBeTruthy()
  })

  it('selects the default image profile when nothing is designated', () => {
    const { select } = renderCard()
    expect(select.value).toBe('')
    expect(screen.getByText('The default image profile (House Artist)')).toBeTruthy()
  })

  it('lists every image profile and marks the uncensored ones', () => {
    renderCard()
    expect(screen.getByText('House Artist (OPENAI - gpt-image-1)')).toBeTruthy()
    expect(screen.getByText('Back Room (GROK - grok-image) (uncensored)')).toBeTruthy()
  })

  it('reflects a stored designation', () => {
    const { select } = renderCard({ wardrobeImageSettings: { imageProfileId: 'p-wild' } })
    expect(select.value).toBe('p-wild')
  })

  it('reports the chosen profile, and null for the default', () => {
    const { select, onProfileChange } = renderCard({ wardrobeImageSettings: { imageProfileId: 'p-wild' } })
    fireEvent.change(select, { target: { value: 'p-default' } })
    expect(onProfileChange).toHaveBeenLastCalledWith('p-default')
    fireEvent.change(select, { target: { value: '' } })
    expect(onProfileChange).toHaveBeenLastCalledWith(null)
  })

  it('is disabled while a save is in flight', () => {
    expect(renderCard({}, { saving: true }).select.disabled).toBe(true)
  })

  it('says so when no image profiles exist', () => {
    renderCard({}, { profiles: [] })
    expect(screen.getByText(/no image profiles have been engaged/)).toBeTruthy()
  })
})
