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

jest.mock('@/lib/toast', () => ({ showErrorToast: jest.fn(), showSuccessToast: jest.fn() }))
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
