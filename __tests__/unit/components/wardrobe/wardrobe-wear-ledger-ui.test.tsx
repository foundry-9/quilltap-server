/**
 * Wear ledger — the operator-facing surfaces
 * (docs/developer/features/wardrobe-wear-ledger.md §5.2 and §5.4):
 *
 *  - the one muted line under a Wardrobe dialog row, and
 *  - the editor's read-only "Wear history" section, fetched on open through
 *    `?action=wear-history`.
 */

// Uses global jest (not @jest/globals) so the jest-dom matcher augmentation
// resolves on the global `expect` under tsc.
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { WardrobeItemRow } from '@/components/wardrobe/wardrobe-item-row'
import {
  WardrobeWearHistorySection,
  type WardrobeWearHistoryResponse,
} from '@/components/wardrobe/wardrobe-item-editor/WardrobeWearHistorySection'
import type { ListedWardrobeItem } from '@/lib/wardrobe/wardrobe-container'
import type { WardrobeWearSummary } from '@/lib/schemas/wardrobe-wear.types'
import { renderWithQuery } from '../../../helpers/renderWithQuery'

const ALICE = '11111111-1111-4111-8111-111111111111'
const GONE = '22222222-2222-4222-8222-222222222222'
const CHAT = '33333333-3333-4333-8333-333333333333'

function makeItem(wear?: WardrobeWearSummary): ListedWardrobeItem & { wear?: WardrobeWearSummary } {
  return {
    id: 'item-1',
    characterId: 'char-1',
    title: 'Charcoal Sweater',
    types: ['top'],
    componentItemIds: [],
    isDefault: false,
    replace: false,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...(wear ? { wear } : {}),
  } as ListedWardrobeItem & { wear?: WardrobeWearSummary }
}

function renderRow(item: ReturnType<typeof makeItem>) {
  return render(
    <WardrobeItemRow
      item={item}
      allItems={[item]}
      inChat={false}
      onToggleDefault={jest.fn()}
      onEdit={jest.fn()}
      onDuplicate={jest.fn()}
      onMove={jest.fn()}
      onCopy={jest.fn()}
      onDelete={jest.fn()}
    />,
  )
}

describe('WardrobeItemRow — wear line', () => {
  it('reads a row without a wear annotation as never worn', () => {
    renderRow(makeItem())
    expect(screen.getByTestId('wardrobe-wear-line')).toHaveTextContent('Never worn')
  })

  it('shows the count and the last wear', () => {
    renderRow(
      makeItem({
        wearCount: 4,
        firstWornAt: '2026-03-14T00:00:00.000Z',
        lastWornAt: '2026-10-06T00:00:00.000Z',
        lastWornChatId: null,
      }),
    )
    expect(screen.getByTestId('wardrobe-wear-line').textContent).toMatch(/^Worn 4× · last /)
  })

  it('says "once" for a single wear', () => {
    renderRow(
      makeItem({
        wearCount: 1,
        firstWornAt: '2026-10-01T00:00:00.000Z',
        lastWornAt: '2026-10-01T00:00:00.000Z',
        lastWornChatId: null,
      }),
    )
    expect(screen.getByTestId('wardrobe-wear-line').textContent).toMatch(/^Worn once · last /)
  })
})

function historyResponse(
  overrides: Partial<WardrobeWearHistoryResponse> = {},
): WardrobeWearHistoryResponse {
  return {
    history: {
      wearCount: 4,
      firstWornAt: '2026-03-14T00:00:00.000Z',
      lastWornAt: '2026-10-06T00:00:00.000Z',
      lastWornChatId: CHAT,
      wearers: [
        {
          characterId: ALICE,
          wearCount: 3,
          firstWornAt: '2026-03-14T00:00:00.000Z',
          lastWornAt: '2026-10-06T00:00:00.000Z',
          lastWornChatId: CHAT,
        },
        {
          characterId: GONE,
          wearCount: 1,
          firstWornAt: '2026-04-01T00:00:00.000Z',
          lastWornAt: '2026-04-01T00:00:00.000Z',
          lastWornChatId: null,
        },
      ],
    },
    wearers: [{ characterId: ALICE, name: 'Vivienne', avatarUrl: '/avatars/v.webp' }],
    lastWornChat: { id: CHAT, title: 'The Thornfield Dinner' },
    ...overrides,
  }
}

function mockHistory(body: WardrobeWearHistoryResponse): jest.Mock {
  const fn = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers({ 'content-type': 'application/json' }),
  }))
  global.fetch = fn as unknown as typeof fetch
  return fn
}

describe('WardrobeWearHistorySection', () => {
  it('fetches ?action=wear-history from the item URL and lays out the breakdown', async () => {
    const fetchMock = mockHistory(historyResponse())
    renderWithQuery(
      <WardrobeWearHistorySection
        itemId="item-1"
        itemUrl="/api/v1/characters/char-1/wardrobe/item-1"
        createdAt="2026-03-12T00:00:00.000Z"
        isComposite={false}
      />,
    )

    const link = await screen.findByRole('link', { name: '“The Thornfield Dinner”' })
    expect(link).toHaveAttribute('href', `/salon/${CHAT}`)
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      '/api/v1/characters/char-1/wardrobe/item-1?action=wear-history',
    )
    expect(screen.getByText('Times worn').nextSibling).toHaveTextContent('4')
    expect(screen.getByText('Created')).toBeInTheDocument()
    expect(screen.getByText('First worn')).toBeInTheDocument()
    expect(screen.getByText('Vivienne')).toBeInTheDocument()
    expect(screen.getByText(/^3×, last /)).toBeInTheDocument()
    // A wearer the server could not name is labelled, not dropped.
    expect(screen.getByText('A departed character')).toBeInTheDocument()
    expect(screen.queryByText(/also counts a wear/)).not.toBeInTheDocument()
  })

  it('says "a chat since deleted" when the last chat is gone', async () => {
    mockHistory(historyResponse({ lastWornChat: null }))
    renderWithQuery(
      <WardrobeWearHistorySection itemId="item-2" itemUrl="/api/v1/wardrobe/item-2" isComposite />,
    )
    await screen.findByText(/in a chat since deleted/)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(
      screen.getByText('Wearing this outfit also counts a wear for each garment it put on.'),
    ).toBeInTheDocument()
  })

  it('shows a never-worn item as zero wears with no dates', async () => {
    mockHistory(
      historyResponse({
        history: {
          wearCount: 0,
          firstWornAt: null,
          lastWornAt: null,
          lastWornChatId: null,
          wearers: [],
        },
        wearers: [],
        lastWornChat: null,
      }),
    )
    renderWithQuery(
      <WardrobeWearHistorySection itemId="item-3" itemUrl="/api/v1/wardrobe/item-3" isComposite={false} />,
    )
    await waitFor(() => expect(screen.getByText('Times worn').nextSibling).toHaveTextContent('0'))
    expect(screen.queryByText('Last worn')).not.toBeInTheDocument()
    expect(screen.queryByText('Worn by')).not.toBeInTheDocument()
  })
})
