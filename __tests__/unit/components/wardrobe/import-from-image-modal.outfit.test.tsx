/**
 * Import from Image — the ensemble offer.
 *
 * After the vision model names the pieces it sees, the review screen offers to
 * bundle them into one composite outfit. Nothing has an id until it's created,
 * so the pieces are posted first and the ids they come back with become the
 * outfit's `componentItemIds`; the outfit's coverage is their slot union.
 */

import { ImportFromImageModal } from '@/components/wardrobe/import-from-image-modal'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}))

const CHARACTER_ID = 'alice'
const WARDROBE_URL = `/api/v1/characters/${CHARACTER_ID}/wardrobe`

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response

const ANALYSIS = {
  proposedItems: [
    { title: 'Velvet Blazer', description: 'Deep green', types: ['top'], appropriateness: 'evening' },
    { title: 'Oxford Brogues', description: 'Oxblood', types: ['footwear'], appropriateness: 'formal' },
  ],
  proposedOutfit: { title: 'Club Night', description: 'Sharp and dark', appropriateness: 'evening' },
  provider: 'ANTHROPIC',
  model: 'claude',
}

/** Posted wardrobe bodies, in order. */
let posted: Record<string, unknown>[] = []

function routeFetch(analysis: unknown = ANALYSIS): void {
  posted = []
  let nextId = 0
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/api/v1/wardrobe/analyze-image')) {
      return jsonResponse(analysis)
    }
    if (url.endsWith(WARDROBE_URL) && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      posted.push(body)
      nextId += 1
      return jsonResponse({ wardrobeItem: { ...body, id: `item-${nextId}` } }, 201)
    }
    throw new Error(`unrouted fetch: ${url}`)
  }) as unknown as typeof fetch
}

async function analyzeAnImage(): Promise<void> {
  const { container } = render(
    <ImportFromImageModal characterId={CHARACTER_ID} onClose={jest.fn()} onImported={jest.fn()} />
  )
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['png-bytes'], 'look.png', { type: 'image/png' })
  fireEvent.change(input, { target: { files: [file] } })
  await waitFor(() => expect(screen.getByAltText('Selected reference image')).toBeTruthy())
  fireEvent.click(screen.getByText('Analyze Image'))
  await screen.findByText('2 items identified')
}

describe('ImportFromImageModal — the ensemble offer', () => {
  it('pre-fills the outfit the model named and bundles the created pieces by their new ids', async () => {
    routeFetch()
    await analyzeAnImage()

    expect((screen.getByLabelText('Outfit title') as HTMLInputElement).value).toBe('Club Night')

    fireEvent.click(screen.getByText('Import 2 Items + Outfit'))
    await waitFor(() => expect(posted).toHaveLength(3))

    const outfit = posted[2]
    expect(outfit).toMatchObject({
      title: 'Club Night',
      description: 'Sharp and dark',
      appropriateness: 'evening',
      componentItemIds: ['item-1', 'item-2'],
      types: ['top', 'footwear'],
      replace: true,
      isDefault: false,
    })
  })

  it('imports only the pieces when the outfit is declined', async () => {
    routeFetch()
    await analyzeAnImage()

    fireEvent.click(screen.getByText('Also create an outfit from these pieces'))
    fireEvent.click(screen.getByText('Import 2 Items'))
    await waitFor(() => expect(posted).toHaveLength(2))
    expect(posted.every((b) => b.componentItemIds === undefined)).toBe(true)
  })

  it('withdraws the offer when fewer than two pieces are selected', async () => {
    routeFetch()
    await analyzeAnImage()

    const [firstPiece] = screen.getAllByRole('checkbox') as HTMLInputElement[]
    fireEvent.click(firstPiece)

    const offer = screen
      .getByText('Also create an outfit from these pieces')
      .closest('label')!
      .querySelector('input') as HTMLInputElement
    expect(offer.disabled).toBe(true)
    expect(offer.checked).toBe(false)
    expect(screen.getByText('Import 1 Item')).toBeTruthy()
  })

  it('leaves the offer off, and asks for a title, when the model named no ensemble', async () => {
    routeFetch({ ...ANALYSIS, proposedOutfit: null })
    await analyzeAnImage()

    expect(screen.getByText('Import 2 Items')).toBeTruthy()
    fireEvent.click(screen.getByText('Also create an outfit from these pieces'))

    const submit = screen.getByText('Import 2 Items + Outfit').closest('button') as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Outfit title'), { target: { value: 'My Look' } })
    expect(submit.disabled).toBe(false)
  })
})
