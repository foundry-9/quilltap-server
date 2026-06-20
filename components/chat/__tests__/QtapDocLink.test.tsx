/**
 * Unit tests for QtapDocLink — the "definite existing documents" gate (§9a):
 * parse failure / pending / missing → plain text; exists+accessible → an active
 * in-app link that opens Document Mode (never a web URL).
 *
 * Uses global jest + @testing-library/react (colocated, type-checked).
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import React from 'react'
import { QtapDocLink } from '@/components/chat/QtapDocLink'
import { QtapDocContext, type QtapDocOpener } from '@/components/chat/QtapDocContext'

function renderWithOpener(href: string, opener: QtapDocOpener) {
  return render(
    <QtapDocContext.Provider value={opener}>
      <QtapDocLink href={href}>the doc</QtapDocLink>
    </QtapDocContext.Provider>
  )
}

describe('QtapDocLink', () => {
  it('renders plain text (no link) when the URI fails to parse', () => {
    const opener: QtapDocOpener = { checkExists: jest.fn(), open: jest.fn() }
    // Not a qtap:// URI at all → parseQtapUri throws → plain text.
    render(
      <QtapDocContext.Provider value={opener}>
        <QtapDocLink href={'https://example.com'}>the doc</QtapDocLink>
      </QtapDocContext.Provider>
    )
    expect(screen.getByText('the doc')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(opener.checkExists).not.toHaveBeenCalled()
  })

  it('renders inert (non-link) text while the existence check is pending', () => {
    let resolve!: (v: boolean) => void
    const opener: QtapDocOpener = {
      checkExists: jest.fn(() => new Promise<boolean>((r) => { resolve = r })),
      open: jest.fn(),
    }
    renderWithOpener('qtap://Notes/today.md', opener)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    const span = screen.getByText('the doc')
    expect(span.tagName).toBe('SPAN')
    expect(span).toHaveClass('qt-qtap-doc--inert')
    resolve(true)
  })

  it('upgrades to an active link when the document exists, and opens Document Mode on click', async () => {
    const open = jest.fn()
    const opener: QtapDocOpener = {
      checkExists: jest.fn().mockResolvedValue(true),
      open,
    }
    renderWithOpener('qtap://Notes/today.md', opener)
    const link = await screen.findByRole('link')
    expect(link).toHaveAttribute('href', 'qtap://Notes/today.md')

    fireEvent.click(link)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'document_store', mountPoint: 'Notes', path: 'today.md' })
    )
  })

  it('stays plain text when the document does not exist / is inaccessible', async () => {
    const opener: QtapDocOpener = {
      checkExists: jest.fn().mockResolvedValue(false),
      open: jest.fn(),
    }
    renderWithOpener('qtap://Notes/missing.md', opener)
    await waitFor(() => expect(opener.checkExists).toHaveBeenCalled())
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('the doc').tagName).toBe('SPAN')
  })

  it('renders plain text when there is no Document-Mode context', () => {
    render(
      <QtapDocContext.Provider value={null}>
        <QtapDocLink href={'qtap://Notes/today.md'}>the doc</QtapDocLink>
      </QtapDocContext.Provider>
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('the doc')).toBeInTheDocument()
  })
})
