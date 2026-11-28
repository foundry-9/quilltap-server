/** #240: Execute runs only what the preview showed; editing an input drops the preview. */
import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RenameReplaceTab } from '@/components/characters/RenameReplaceTab'

jest.mock('@/lib/alert', () => ({ showAlert: jest.fn().mockResolvedValue('Execute') }))

const previewBody = {
  characterId: 'c1',
  characterName: 'Old',
  dryRun: true,
  replacements: [],
  summary: { characterFields: 1, physicalDescriptions: 0, memories: 0, chatTitles: 0, chatMessages: 0, total: 3 },
}

describe('RenameReplaceTab stale preview', () => {
  it('hides the preview when an input changes after previewing', async () => {
    (global as any).fetch = jest.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => previewBody }))
    render(<RenameReplaceTab characterId="c1" characterName="Old" />)
    const input = screen.getByPlaceholderText('Enter new name')
    fireEvent.change(input, { target: { value: 'A' } })
    fireEvent.click(screen.getByText('Preview Changes'))
    await screen.findByText('Execute 3 Replacements')

    fireEvent.change(input, { target: { value: 'B' } })
    expect(screen.queryByText('Execute 3 Replacements')).toBeNull()

    fireEvent.click(screen.getByText('Preview Changes'))
    await waitFor(() => expect(screen.getByText('Execute 3 Replacements')).toBeTruthy())
  })
})
