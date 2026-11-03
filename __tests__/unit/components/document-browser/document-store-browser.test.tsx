/**
 * The Scriptorium's folder browser (`DocumentStoreBrowser`) against a mocked
 * `/api/v1/mount-points` API: folder rows and navigation, the ⋮ menu gated
 * by the store's capabilities and the row (hard links), rename through the
 * item route's PATCH, a recursive folder delete after a confirmation, and a
 * move through the destination dialog, and pick mode (Document Mode's picker).
 */

import React from 'react'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { DocumentStoreBrowser } from '@/components/document-browser/DocumentStoreBrowser'

jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn(), showSuccessToast: jest.fn() }))
jest.mock('@/lib/alert', () => ({ showConfirmation: jest.fn(async () => true) }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@/components/providers/workspace-provider', () => ({ useWorkspaceOptional: () => null }))
jest.mock('@/components/document-browser/DocumentViewer', () => ({
  DocumentViewerModal: () => null,
  downloadDocument: jest.fn(),
}))

const T = '2026-10-31T00:00:00.000Z'
const CAPS = { canWrite: true, canDelete: true, canCreateFolder: true, canMoveIn: true, canMoveOut: true, canConvert: true }

function store(id: string, name: string, capabilities = CAPS) {
  return {
    id, name, basePath: '', mountType: 'database', storeType: 'documents', enabled: true, capabilities,
    includePatterns: [], excludePatterns: [], lastScannedAt: null, scanStatus: 'idle', lastScanError: null,
    conversionStatus: 'idle', conversionError: null, fileCount: 3, chunkCount: 0, totalSizeBytes: 300,
    embeddedChunkCount: 0, createdAt: T, updatedAt: T,
  }
}

function file(relativePath: string, fields: Record<string, unknown> = {}) {
  return {
    id: `link-${relativePath}`, fileId: `file-${relativePath}`, mountPointId: 'store-a', relativePath,
    fileName: relativePath.split('/').pop(), folderId: null, originalFileName: null, originalMimeType: null,
    description: '', descriptionUpdatedAt: null, conversionStatus: 'converted', conversionError: null,
    plainTextLength: null, extractedTextSha256: null, extractionStatus: 'none', extractionError: null,
    chunkCount: 0, linkGroupId: null, linkCount: 1, lastModified: T, createdAt: T, updatedAt: T,
    sha256: 'x', fileSizeBytes: 100, fileType: 'markdown', source: 'database', ...fields,
  }
}

const FILES = [
  file('notes.md'),
  file('Drafts/chapter-one.md', { linkGroupId: 'g1', linkCount: 2 }),
  file('Drafts/old/outline.md'),
]

const calls: Array<{ method: string; url: string; body: unknown }> = []

type Route = (method: string, path: string) => unknown

function serve(route: Route) {
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    calls.push({ method, url: url.pathname + url.search, body })
    const payload = route(method, url.pathname) ?? { success: true }
    return { ok: true, status: 200, statusText: 'OK', json: async () => payload } as Response
  }) as unknown as typeof fetch
}

const CATALOGUE = { mountPoints: [store('store-a', 'Archive'), store('store-b', 'Second Shelf')] }

beforeEach(() => {
  calls.length = 0
  serve((method, path) => {
    if (method !== 'GET') return null
    if (path === '/api/v1/mount-points/store-a') return { mountPoint: store('store-a', 'Archive') }
    if (path === '/api/v1/mount-points/store-a/files') return { files: FILES, folders: ['Drafts', 'Drafts/old', 'Empty'] }
    if (path === '/api/v1/mount-points/store-b/files') return { files: [], folders: ['Inbox'] }
    if (path === '/api/v1/mount-points') return CATALOGUE
    return null
  })
})

async function renderBrowser() {
  renderWithQuery(<DocumentStoreBrowser storeId="store-a" />)
  await screen.findByText('notes.md')
}

function openMenu(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }))
  return screen.getByRole('menu', { name: label })
}

describe('DocumentStoreBrowser', () => {
  it('lists the top folder: folder rows (empty ones too) and the files directly inside', async () => {
    await renderBrowser()
    const folders = screen.getAllByTestId('documents-folder-row').map((r) => r.textContent)
    expect(folders).toEqual([expect.stringContaining('Drafts'), expect.stringContaining('Empty')])
    expect(screen.getAllByTestId('document-row')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }))
    await screen.findByText('chapter-one.md')
    expect(screen.queryByText('notes.md')).toBeNull()
    expect(screen.getByText('Hard-linked')).toBeInTheDocument()
  })

  it('offers the link entries on a hard-linked file only', async () => {
    await renderBrowser()
    const plain = openMenu('Actions for notes.md')
    expect(within(plain).queryByRole('menuitem', { name: /Where else/ })).toBeNull()
    expect(within(plain).getByRole('menuitem', { name: 'Hard link to…' })).toBeInTheDocument()
    fireEvent.keyDown(plain, { key: 'Escape' })

    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }))
    await screen.findByText('chapter-one.md')
    const linked = openMenu('Actions for chapter-one.md')
    expect(within(linked).getByRole('menuitem', { name: 'Where else this appears…' })).toBeInTheDocument()
    expect(within(linked).getByRole('menuitem', { name: 'Unlink from its twins' })).toBeInTheDocument()
  })

  it('renames a file in place through the item route', async () => {
    await renderBrowser()
    fireEvent.click(within(openMenu('Actions for notes.md')).getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'Rename notes.md' })
    fireEvent.change(input, { target: { value: 'journal.md' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'PATCH', url: '/api/v1/mount-points/store-a/files/notes.md', body: { rename: 'journal.md' } }),
    )
  })

  it('deletes a folder with everything in it, after saying so', async () => {
    const { showConfirmation } = jest.requireMock('@/lib/alert')
    await renderBrowser()
    const row = screen.getAllByTestId('documents-folder-row')[0]
    fireEvent.click(within(row).getByRole('button', { name: 'Folder actions for Drafts' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        url: '/api/v1/mount-points/store-a?action=delete-folder',
        body: { path: 'Drafts', recursive: true },
      }),
    )
    expect(showConfirmation).toHaveBeenCalledWith(expect.stringContaining('the 2 files inside it'))
  })

  it('moves a file to a folder of another store', async () => {
    await renderBrowser()
    fireEvent.click(within(openMenu('Actions for notes.md')).getByRole('menuitem', { name: 'Move to…' }))
    const dialog = await screen.findByRole('dialog')
    const select = within(dialog).getByLabelText('Store')
    await waitFor(() => expect(within(select).getByRole('option', { name: 'Second Shelf' })).toBeInTheDocument())
    fireEvent.change(select, { target: { value: 'store-b' } })
    fireEvent.click(await within(dialog).findByRole('option', { name: /Inbox/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        url: '/api/v1/mount-points/store-a?action=move-file',
        body: { sourcePath: 'notes.md', destMountPointId: 'store-b', destPath: 'Inbox/notes.md' },
      }),
    )
  })

  it('in pick mode, opening a file hands it over and the footer gets the extra buttons', async () => {
    const onPickFile = jest.fn()
    renderWithQuery(
      <DocumentStoreBrowser
        storeId="store-a"
        onPickFile={onPickFile}
        footerActions={(folder) => <button type="button">New here {folder || '(top)'}</button>}
      />,
    )
    await screen.findByText('notes.md')
    expect(screen.getByRole('button', { name: 'New here (top)' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'notes.md' }))
    expect(onPickFile).toHaveBeenCalledWith(expect.objectContaining({ relativePath: 'notes.md' }))
    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }))
    expect(await screen.findByRole('button', { name: 'New here Drafts' })).toBeInTheDocument()
  })

  it('hides every write on a store that allows none', async () => {
    const closed = { ...CAPS, canWrite: false, canDelete: false, canMoveIn: false, canMoveOut: false }
    serve((method, path) => {
      if (path === '/api/v1/mount-points/store-a') return { mountPoint: store('store-a', 'Archive', closed) }
      if (path === '/api/v1/mount-points/store-a/files') return { files: FILES, folders: ['Drafts'] }
      return { mountPoints: [] }
    })
    await renderBrowser()
    const menu = openMenu('Actions for notes.md')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open', 'Download'])
    expect(screen.queryByText('Upload here')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Folder actions for Drafts' })).toBeNull()
  })
})
