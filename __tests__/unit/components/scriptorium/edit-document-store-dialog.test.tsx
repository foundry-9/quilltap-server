/**
 * #169: the Scriptorium list's Edit dialog seeded its state once while no
 * store was selected, so it opened with Filesystem / Documents / Enabled and
 * saved those defaults over the store. It now sends only what changed, and an
 * emptied pattern field is sent as an empty list.
 */

import React from 'react'
import { render, fireEvent, screen } from '@testing-library/react'

jest.mock('@/app/scriptorium/components/DirectoryPicker', () => ({
  DirectoryPicker: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="Path" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

import { EditDocumentStoreDialog } from '@/app/scriptorium/components/EditDocumentStoreDialog'
import type { DocumentStore } from '@/app/scriptorium/types'

function makeStore(over: Partial<DocumentStore> = {}): DocumentStore {
  return {
    id: 'store-1',
    name: 'Notes',
    basePath: '/vaults/notes',
    mountType: 'obsidian',
    storeType: 'documents',
    includePatterns: ['**/*.md'],
    excludePatterns: ['.obsidian/**'],
    enabled: false,
    lastScannedAt: null,
    scanStatus: 'idle',
    lastScanError: null,
    conversionStatus: 'idle',
    conversionError: null,
    fileCount: 0,
    chunkCount: 0,
    totalSizeBytes: 0,
    embeddedChunkCount: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...over,
  }
}

describe('EditDocumentStoreDialog', () => {
  it('a name-only edit of a disabled Obsidian store sends only the name', () => {
    const onSubmit = jest.fn()
    render(<EditDocumentStoreDialog store={makeStore()} onClose={jest.fn()} onSubmit={onSubmit} />)

    expect((screen.getByLabelText('Obsidian Vault') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Enabled') as HTMLInputElement).checked).toBe(false)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Field Notes' } })
    fireEvent.click(screen.getByText('Save Changes'))

    expect(onSubmit).toHaveBeenCalledWith('store-1', { name: 'Field Notes' })
  })

  it('clearing a pattern field sends an empty list', () => {
    const onSubmit = jest.fn()
    render(<EditDocumentStoreDialog store={makeStore()} onClose={jest.fn()} onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText('Exclude Patterns'), { target: { value: '' } })
    fireEvent.click(screen.getByText('Save Changes'))

    expect(onSubmit).toHaveBeenCalledWith('store-1', { excludePatterns: [] })
  })
})
