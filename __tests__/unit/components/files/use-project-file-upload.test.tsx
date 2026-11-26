/**
 * The project page's Files card posted to `/api/v1/projects/[id]/files/upload`,
 * a route that never existed, so every upload failed with Next's 409 "Server
 * Action unavailable" (fresh-instance dogfood, 4.14.1). Uploads now go through
 * the files collection's upload action with the project id in the form.
 */

import { act, renderHook } from '@testing-library/react'
import { useProjectFileUpload } from '@/components/files/useProjectFileUpload'

jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn(), showSuccessToast: jest.fn() }))

const uploaded = {
  id: 'f1',
  originalFilename: 'chapter-one.md',
  mimeType: 'text/markdown',
  size: 10,
  category: 'DOCUMENT',
  folderPath: '/drafts/',
  createdAt: '2026-11-26T00:00:00.000Z',
}

describe('useProjectFileUpload', () => {
  const realFetch = global.fetch

  afterEach(() => {
    global.fetch = realFetch
  })

  it('posts to the files upload action with the project id and reads `data`', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ data: uploaded }),
      json: async () => ({ data: uploaded }),
      headers: new Headers({ 'content-type': 'application/json' }),
    })
    global.fetch = fetchMock as unknown as typeof fetch
    const onSuccess = jest.fn()

    const { result } = renderHook(() =>
      useProjectFileUpload({ projectId: 'proj-1', folderPath: '/drafts/', onSuccess }),
    )
    await act(async () => {
      await result.current.uploadFiles([new File(['# One'], 'chapter-one.md', { type: 'text/markdown' })])
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/files?action=upload')
    const body = init.body as FormData
    expect(body.get('projectId')).toBe('proj-1')
    expect(body.get('folderPath')).toBe('/drafts/')
    expect((body.get('file') as File).name).toBe('chapter-one.md')
    expect(onSuccess).toHaveBeenCalledWith([uploaded])
    expect(result.current.error).toBeNull()
  })
})
