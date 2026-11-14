/**
 * The search dialog: a slow answer for an earlier term never replaces the
 * answer for the term on screen (the term and type filter are the query key).
 */
import React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { SearchDialog } from '@/components/search/search-dialog'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))

const mockFetch = global.fetch as jest.Mock

function result(id: string, name: string) {
  return { id, type: 'characters', name, matchedField: 'name', matchedValue: name, snippet: name, url: `/aurora/${id}` }
}

describe('SearchDialog stale answers', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockImplementation(async (url: string) => {
      const q = new URL(url, 'http://localhost').searchParams.get('q')
      const body = (results: unknown[]) => ({ results, totalCount: results.length, query: q, types: [], hasMore: false })
      if (q === 'old') {
        await new Promise((resolve) => setTimeout(resolve, 80))
        return { ok: true, status: 200, json: async () => body([result('1', 'Stale Gatsby')]) }
      }
      return { ok: true, status: 200, json: async () => body([result('2', 'Fresh Carraway')]) }
    })
  })

  it('shows the newer term’s results even when the older answer lands last', async () => {
    renderWithQuery(<SearchDialog isOpen onClose={jest.fn()} initialQuery="old" />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())

    const input = screen.getByPlaceholderText(/search chats/i)
    fireEvent.change(input, { target: { value: 'new' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(screen.getAllByText('Fresh Carraway').length).toBeGreaterThan(0))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)) })
    expect(screen.queryAllByText('Stale Gatsby')).toHaveLength(0)
  })
})
