/**
 * SaveImageDialog's item doors — a Wardrobe item's, an Inventory object's and
 * an Atlas entry's picture viewer. Each reads its albums from, and posts its
 * save to, the item's own images route (the shared `createItemImagesRoute`),
 * never a chat route.
 */

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SaveImageDialog, type SaveImageTarget } from '@/app/salon/[id]/components/SaveImageDialog'

const CONTAINER = { scope: 'project' as const, id: 'proj-1' }

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    statusText: '',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

const CASES: Array<{ kind: 'wardrobe' | 'inventory' | 'atlas'; base: string }> = [
  { kind: 'wardrobe', base: '/api/v1/wardrobe/item-1/images?scope=project&id=proj-1' },
  { kind: 'inventory', base: '/api/v1/inventory/item-1/images?scope=project&id=proj-1' },
  { kind: 'atlas', base: '/api/v1/atlas/item-1/images?scope=project&id=proj-1' },
]

describe.each(CASES)('SaveImageDialog ($kind door)', ({ kind, base }) => {
  beforeEach(() => {
    global.fetch = jest.fn(async (url: string) =>
      String(url).includes('save-targets')
        ? jsonResponse({ albums: [{ mountPointId: 'mp-1', name: 'Quilltap General', kind: 'general', isDefault: true }] })
        : jsonResponse({ mountPoint: 'Quilltap General', relativePath: 'photos/Convertible.webp' }),
    ) as unknown as typeof fetch
  })

  it('reads albums from and saves through the item\'s images route', async () => {
    const onSaved = jest.fn()
    const onClose = jest.fn()
    const target: SaveImageTarget = { kind, itemId: 'item-1', container: CONTAINER, fileId: 'file-1' }
    render(
      <SaveImageDialog
        isOpen={true}
        onClose={onClose}
        target={target}
        attachments={[{ id: 'file-1', filename: 'Convertible.webp', filepath: '/api/v1/files/file-1', mimeType: 'image/webp' }]}
        onSaved={onSaved}
      />,
    )

    expect(await screen.findByRole('option', { name: 'Quilltap General' })).toBeInTheDocument()
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(`${base}&action=save-targets`)

    fireEvent.click(screen.getByRole('button', { name: 'Save image' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ mountPoint: 'Quilltap General', relativePath: 'photos/Convertible.webp' }))

    const [url, init] = (global.fetch as jest.Mock).mock.calls[1] as [string, RequestInit]
    expect(url).toBe(`${base}&action=save-to-store`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ fileId: 'file-1', mountPointId: 'mp-1' })
    expect(onClose).toHaveBeenCalled()
  })
})
