/**
 * The shared Pictures section of the Inventory and Atlas editors:
 * each kind's spec decides the route, the request, the refreshed queries
 * and the words; the section draws the strip, runs Generate / Use / Delete
 * through the spec, and hides the controls on an inherited picture.
 */

import React from 'react'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { ItemPicturesSection, type ItemPicturesSpec } from '@/components/item-browser/ItemPicturesSection'
import type { ItemImageSummary } from '@/lib/mount-index/item-family-images'
import { showErrorToast } from '@/lib/toast'
import { showConfirmation } from '@/lib/alert'

jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn(), showSuccessToast: jest.fn() }))
jest.mock('@/lib/alert', () => ({ showConfirmation: jest.fn() }))
jest.mock('@/components/item-browser/ItemImageViewer', () => ({
  ItemImageViewer: ({ fileId, note }: { fileId: string; note?: string | null }) => (
    <div data-testid="viewer">{`${fileId}|${note ?? 'no-note'}`}</div>
  ),
}))

const GENERAL = { scope: 'general' as const, id: null }

function image(fileId: string, extra: Partial<ItemImageSummary> = {}): ItemImageSummary {
  return { fileId, thumbnailUrl: `/thumb/${fileId}`, ...extra } as ItemImageSummary
}

function makeSpec(images: ItemImageSummary[], overrides: Partial<ItemPicturesSpec> = {}): ItemPicturesSpec {
  return {
    kind: 'atlas',
    useImages: () => ({ images, current: images[0]?.fileId ?? null, loading: false }),
    imagesUrl: (_c, id, action) => `/images/${id}?action=${action}`,
    request: jest.fn(async () => ({})),
    refreshKeys: (id) => [['pictures', id]],
    describeError: (_e, fallback) => `refused: ${fallback}`,
    generatingLabel: 'Sketching…',
    emptyText: 'Nothing hung yet.',
    viewLabel: (index, title) => `View ${index + 1} of ${title}`,
    ...overrides,
  }
}

describe('ItemPicturesSection', () => {
  beforeEach(() => jest.clearAllMocks())

  it('shows the empty text when there are no pictures', () => {
    renderWithQuery(<ItemPicturesSection spec={makeSpec([])} container={GENERAL} itemId="i1" itemTitle="Roadster" />)
    expect(screen.getByText('Nothing hung yet.')).toBeInTheDocument()
  })

  it('makes a picture current through the spec request and route', async () => {
    const spec = makeSpec([image('f1'), image('f2')])
    renderWithQuery(<ItemPicturesSection spec={spec} container={GENERAL} itemId="i1" itemTitle="Roadster" />)
    expect(screen.getByRole('button', { name: 'Current' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Use' }))
    await waitFor(() =>
      expect(spec.request).toHaveBeenCalledWith('/images/i1?action=set-current', 'POST', { fileId: 'f2' }),
    )
  })

  it('names a failed request with the spec wording', async () => {
    const spec = makeSpec([image('f1')], { request: jest.fn(async () => { throw new Error('no') }) })
    renderWithQuery(<ItemPicturesSection spec={spec} container={GENERAL} itemId="i1" itemTitle="Roadster" />)
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith('refused: The picture would not oblige'))
  })

  it('hides Use and Delete on inherited pictures and shows the inherited note', () => {
    const spec = makeSpec([image('f1', { inherited: true })], { kind: 'inventory', inheritedNote: 'From the archetype.' })
    renderWithQuery(<ItemPicturesSection spec={spec} container={GENERAL} itemId="i1" itemTitle="Bow" />)
    expect(screen.getByText('From the archetype.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('captions the current picture only when the spec asks', () => {
    const { unmount } = renderWithQuery(
      <ItemPicturesSection spec={makeSpec([image('f1')], { noteCurrent: true })} container={GENERAL} itemId="i1" itemTitle="Roadster" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'View 1 of Roadster' }))
    expect(screen.getByTestId('viewer')).toHaveTextContent('f1|Current picture')
    unmount()
    renderWithQuery(<ItemPicturesSection spec={makeSpec([image('f1')])} container={GENERAL} itemId="i1" itemTitle="Roadster" />)
    fireEvent.click(screen.getByRole('button', { name: 'View 1 of Roadster' }))
    expect(screen.getByTestId('viewer')).toHaveTextContent('f1|no-note')
  })
})

// #265 — Upload was a <label> around a hidden input: the keyboard could not
// reach it, and the input kept its value, so choosing the same file again
// fired no change and nothing went up.
describe('ItemPicturesSection — upload control (#265)', () => {
  const mockFetch = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    // jest.setup replaces global.fetch with a plain jest.fn; own it here.
    global.fetch = mockFetch as unknown as typeof fetch
  })

  function fileInput(container: HTMLElement): HTMLInputElement {
    const input = container.querySelector('input[type="file"]')
    expect(input).not.toBeNull()
    return input as HTMLInputElement
  }

  it('is a real button, named by the spec when it has a label', () => {
    const { unmount } = renderWithQuery(
      <ItemPicturesSection spec={makeSpec([])} container={GENERAL} itemId="i1" itemTitle="Roadster" />,
    )
    expect(screen.getByRole('button', { name: 'Upload…' })).toBeInTheDocument()
    unmount()

    renderWithQuery(
      <ItemPicturesSection
        spec={makeSpec([], { uploadLabel: (title) => `Upload a picture of ${title}` })}
        container={GENERAL}
        itemId="i1"
        itemTitle="Roadster"
      />,
    )
    const button = screen.getByRole('button', { name: 'Upload a picture of Roadster' })
    expect(button.tagName).toBe('BUTTON')
  })

  it('opens the hidden file chooser when clicked', () => {
    const { container } = renderWithQuery(
      <ItemPicturesSection spec={makeSpec([])} container={GENERAL} itemId="i1" itemTitle="Roadster" />,
    )
    const input = fileInput(container)
    const click = jest.spyOn(input, 'click').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: 'Upload…' }))
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('clears the input after each pick, so the same file can go up twice', async () => {
    const valueSetter = jest.spyOn(HTMLInputElement.prototype, 'value', 'set')
    try {
      const { container } = renderWithQuery(
        <ItemPicturesSection spec={makeSpec([])} container={GENERAL} itemId="i1" itemTitle="Roadster" />,
      )
      const input = fileInput(container)
      const file = new File(['bytes'], 'roadster.png', { type: 'image/png' })

      valueSetter.mockClear()
      fireEvent.change(input, { target: { files: [file] } })
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1))
      expect(valueSetter).toHaveBeenCalledWith('')
      await waitFor(() => expect(screen.getByRole('button', { name: 'Upload…' })).not.toBeDisabled())

      fireEvent.change(input, { target: { files: [file] } })
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))

      for (const [url, init] of mockFetch.mock.calls) {
        expect(url).toBe('/images/i1?action=upload')
        expect((init as RequestInit).method).toBe('POST')
        expect(((init as RequestInit).body as FormData).get('file')).toBe(file)
      }
    } finally {
      valueSetter.mockRestore()
    }
  })
})

// #311 — Delete took a picture down on one click; a generated one would have
// to be drawn (and paid for) again.
describe('ItemPicturesSection — delete asks first (#311)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('sends nothing when the confirmation is declined', async () => {
    ;(showConfirmation as jest.Mock).mockResolvedValue(false)
    const spec = makeSpec([image('f1')])
    renderWithQuery(<ItemPicturesSection spec={spec} container={GENERAL} itemId="i1" itemTitle="Roadster" />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(showConfirmation).toHaveBeenCalledTimes(1))
    // Let the declined confirmation settle before asserting nothing was sent.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(spec.request).not.toHaveBeenCalled()
  })

  it('deletes through the spec once confirmed', async () => {
    ;(showConfirmation as jest.Mock).mockResolvedValue(true)
    const spec = makeSpec([image('f1')])
    renderWithQuery(<ItemPicturesSection spec={spec} container={GENERAL} itemId="i1" itemTitle="Roadster" />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(spec.request).toHaveBeenCalledWith('/images/i1?action=delete-image', 'POST', { fileId: 'f1' }),
    )
    expect(showConfirmation).toHaveBeenCalledTimes(1)
  })
})
