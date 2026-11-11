/**
 * @jest-environment node
 *
 * `serveStoredBytes` decides how a browser may treat stored bytes: only
 * passive types (raster images, PDF, plain text) are ever inline; active
 * types are labelled `application/octet-stream` (SVG keeps its own type so
 * image contexts can decode it, but is always an attachment); and every
 * response is `nosniff` with a restrictive CSP. The mount-point blob route is
 * exercised end to end.
 */

jest.mock('@/lib/logger', () => {
  const mock: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  mock.child = jest.fn(() => mock)
  return { logger: mock }
})

import { NextRequest } from 'next/server'
import {
  STORED_BYTES_CSP,
  STORED_PDF_CSP,
  serveStoredBytes,
  servedContentType,
  servedDisposition,
  storedBytesHeaders,
} from '@/lib/api/serve-stored-bytes'
import { GET as blobsGet } from '@/app/api/v1/mount-points/[id]/blobs/[...path]/route'
import { getServerSession } from '@/lib/auth/session'
import { getRepositories, getRepositoriesSafe } from '@/lib/repositories/factory'
import {
  createMockRepositoryContainer,
  setupAuthMocks,
} from '@/__tests__/unit/lib/fixtures/mock-repositories'

describe('servedDisposition', () => {
  it.each(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'application/pdf', 'text/plain; charset=utf-8'])(
    'serves %s inline when asked',
    (mime) => {
      expect(servedDisposition(mime, 'inline')).toBe('inline')
      expect(servedDisposition(mime, 'attachment')).toBe('attachment')
    }
  )

  it.each(['text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/xml', 'application/javascript', 'text/markdown', 'application/json', 'font/woff2', '', null, undefined])(
    'serves %p as an attachment regardless of the request',
    (mime) => {
      expect(servedDisposition(mime, 'inline')).toBe('attachment')
    }
  )

  it('is case- and parameter-insensitive', () => {
    expect(servedDisposition('IMAGE/PNG', 'inline')).toBe('inline')
    expect(servedDisposition('Text/HTML; charset=utf-8', 'inline')).toBe('attachment')
  })
})

describe('servedContentType', () => {
  it('relabels active types as octet-stream', () => {
    for (const mime of ['text/html', 'TEXT/HTML; charset=utf-8', 'application/xhtml+xml', 'text/xml', 'application/xml', 'application/javascript', 'text/javascript', 'application/atom+xml', 'application/wasm']) {
      expect(servedContentType(mime)).toBe('application/octet-stream')
    }
  })

  it('keeps SVG labelled as an image so <img> and CSS can decode it', () => {
    expect(servedContentType('image/svg+xml')).toBe('image/svg+xml')
  })

  it('keeps passive and unknown types as stored, defaulting a missing one', () => {
    expect(servedContentType('image/webp')).toBe('image/webp')
    expect(servedContentType('text/plain; charset=utf-8')).toBe('text/plain; charset=utf-8')
    expect(servedContentType('application/json')).toBe('application/json')
    expect(servedContentType('')).toBe('application/octet-stream')
    expect(servedContentType(undefined)).toBe('application/octet-stream')
  })
})

describe('storedBytesHeaders', () => {
  it('always sends nosniff and the sandbox CSP', () => {
    const headers = storedBytesHeaders({ mimeType: 'image/png', filename: 'a.png', size: 3, cacheControl: 'private' })
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['Content-Security-Policy']).toBe(STORED_BYTES_CSP)
    expect(headers['Content-Security-Policy'].startsWith('sandbox;')).toBe(true)
    expect(headers['Content-Disposition']).toBe('inline; filename="a.png"')
    expect(headers['Content-Length']).toBe('3')
    expect(headers['Cache-Control']).toBe('private')
  })

  it('omits sandbox only for an inline PDF', () => {
    expect(storedBytesHeaders({ mimeType: 'application/pdf', filename: 'a.pdf' })['Content-Security-Policy']).toBe(STORED_PDF_CSP)
    expect(
      storedBytesHeaders({ mimeType: 'application/pdf', filename: 'a.pdf', requested: 'attachment' })['Content-Security-Policy']
    ).toBe(STORED_BYTES_CSP)
  })

  it('lets extra headers through but never over the rules', () => {
    const headers = storedBytesHeaders({
      mimeType: 'text/html',
      filename: 'page.html',
      extra: { 'X-Blob-Sha256': 'abc', 'Content-Type': 'text/html', 'Content-Security-Policy': '' },
    })
    expect(headers['X-Blob-Sha256']).toBe('abc')
    expect(headers['Content-Type']).toBe('application/octet-stream')
    expect(headers['Content-Security-Policy']).toBe(STORED_BYTES_CSP)
    expect(headers['Content-Disposition']).toBe('attachment; filename="page.html"')
  })

  it('serveStoredBytes sets Content-Length from the body', () => {
    const response = serveStoredBytes(new Uint8Array([1, 2, 3, 4]), { mimeType: 'image/gif', filename: 'g.gif' })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Length')).toBe('4')
  })
})

describe('GET /api/v1/mount-points/[id]/blobs/[...path]', () => {
  const mockRepos = createMockRepositoryContainer()

  async function fetchBlob(name: string, storedMimeType: string, query = ''): Promise<Response> {
    jest.mocked(getRepositories).mockReturnValue(mockRepos as never)
    jest.mocked(getRepositoriesSafe).mockResolvedValue(mockRepos as never)
    setupAuthMocks(jest.mocked(getServerSession) as jest.Mock, mockRepos)
    ;(mockRepos as unknown as Record<string, unknown>).docMountBlobs = {
      findByMountPointAndPath: jest.fn().mockResolvedValue({
        id: 'blob-1',
        storedMimeType,
        sizeBytes: 5,
        sha256: 'sha-1',
        originalFileName: name,
      }),
      readData: jest.fn().mockResolvedValue(Buffer.from('<b>x</b>')),
    }
    return blobsGet(
      new NextRequest(`http://localhost:3000/api/v1/mount-points/m-1/blobs/notes/${name}${query}`),
      { params: Promise.resolve({ id: 'm-1', path: ['notes', name] }) } as never
    )
  }

  it('serves a stored text/html blob as an octet-stream attachment', async () => {
    const response = await fetchBlob('page.html', 'text/html')
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="page.html"')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Security-Policy')).toBe(STORED_BYTES_CSP)
    expect(response.headers.get('X-Blob-Sha256')).toBe('sha-1')
  })

  it('serves an SVG blob as an image/svg+xml attachment', async () => {
    const response = await fetchBlob('logo.svg', 'image/svg+xml')
    expect(response.headers.get('Content-Type')).toBe('image/svg+xml')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="logo.svg"')
  })

  it('still serves a raster image inline', async () => {
    const response = await fetchBlob('a.webp', 'image/webp')
    expect(response.headers.get('Content-Type')).toBe('image/webp')
    expect(response.headers.get('Content-Disposition')).toBe('inline; filename="a.webp"')
  })
})
