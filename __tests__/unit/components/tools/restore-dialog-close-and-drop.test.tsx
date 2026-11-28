/**
 * Restore dialog.
 *
 * #333 — closing a finished restore by the X, Escape or an outside click
 * skipped the reload that the footer's Close did.
 * #334 — the drop zone invited a drop but had no drop handler.
 */

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { RestoreDialog } from '@/components/tools/restore/RestoreDialog'
import { RestoreItemSelector } from '@/components/tools/restore/RestoreItemSelector'
import { useRestoreData } from '@/components/tools/restore/hooks/useRestoreData'

jest.mock('@/components/tools/restore/hooks/useRestoreData', () => ({ useRestoreData: jest.fn() }))
jest.mock('@/components/tools/restore/RestoreProgress', () => ({
  RestoreProgress: () => <div>progress</div>,
}))

const mockedUseRestoreData = useRestoreData as jest.Mock

function hookValue(overrides: Record<string, unknown>) {
  return {
    state: {
      step: 'progress',
      selectedFile: null,
      restoring: false,
      uploading: false,
      loadingPreview: false,
      restoreSummary: null,
      error: null,
      preview: null,
      restoreMode: 'import',
      confirmReplace: false,
      keepArchiveBundles: true,
      uploadProgress: 0,
      ...overrides,
    },
    actions: {
      resetDialog: jest.fn(),
      handleBack: jest.fn(),
      handleNext: jest.fn(),
      handleStartRestore: jest.fn(),
      handleFileSelect: jest.fn(),
      selectFile: jest.fn(),
      setRestoreMode: jest.fn(),
      setConfirmReplace: jest.fn(),
      setKeepArchiveBundles: jest.fn(),
    },
  }
}

describe('RestoreDialog close after a finished restore (#333)', () => {
  it('Escape runs the restore-complete path', () => {
    mockedUseRestoreData.mockReturnValue(hookValue({ restoreSummary: { characters: 1 } }))
    const onClose = jest.fn()
    const onRestoreComplete = jest.fn()
    render(<RestoreDialog isOpen onClose={onClose} onRestoreComplete={onRestoreComplete} />)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(onRestoreComplete).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape before any restore just closes', () => {
    mockedUseRestoreData.mockReturnValue(hookValue({ step: 'source' }))
    const onClose = jest.fn()
    const onRestoreComplete = jest.fn()
    render(<RestoreDialog isOpen onClose={onClose} onRestoreComplete={onRestoreComplete} />)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(onRestoreComplete).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})

describe('RestoreItemSelector drop (#334)', () => {
  it('hands a dropped file to onFileDrop and prevents the browser default', () => {
    const onFileDrop = jest.fn()
    render(<RestoreItemSelector selectedFile={null} error={null} onFileSelect={jest.fn()} onFileDrop={onFileDrop} />)
    const zone = screen.getByRole('button', { name: /choose a backup file/i })
    const file = new File(['zip'], 'backup.zip', { type: 'application/zip' })
    const dragOver = fireEvent.dragOver(zone, { dataTransfer: { files: [file] } })
    expect(dragOver).toBe(false) // default prevented
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    expect(onFileDrop).toHaveBeenCalledWith(file)
  })

  it('offers only .zip in the browse dialog', () => {
    const { container } = render(
      <RestoreItemSelector selectedFile={null} error={null} onFileSelect={jest.fn()} onFileDrop={jest.fn()} />,
    )
    expect(container.querySelector('input[type="file"]')?.getAttribute('accept')).toBe('.zip,application/zip')
  })
})
