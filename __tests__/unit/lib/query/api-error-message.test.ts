/**
 * @jest-environment node
 */
import { ApiFetchError, apiErrorMessage } from '@/lib/query/fetcher'

describe('apiErrorMessage', () => {
  const failure = (info?: unknown) =>
    new ApiFetchError('Request to /api/v1/things failed: 500 Internal Server Error', 500, info)

  it('reads the server sentence from { error }', () => {
    expect(apiErrorMessage(failure({ error: 'That name is taken.' }), 'Could not save.')).toBe(
      'That name is taken.',
    )
  })

  it('accepts the older { message } shape, and prefers error over it', () => {
    expect(apiErrorMessage(failure({ message: 'Older shape.' }), 'Could not save.')).toBe('Older shape.')
    expect(apiErrorMessage(failure({ error: 'Newer.', message: 'Older.' }), 'Could not save.')).toBe('Newer.')
  })

  it("falls back to the caller's sentence when the body carried none", () => {
    // The error's own message names the URL and status: fit for a log, not a toast.
    expect(apiErrorMessage(failure(), 'Could not save.')).toBe('Could not save.')
    expect(apiErrorMessage(failure({}), 'Could not save.')).toBe('Could not save.')
    expect(apiErrorMessage(failure({ error: '' }), 'Could not save.')).toBe('Could not save.')
    expect(apiErrorMessage(failure('<html>'), 'Could not save.')).toBe('Could not save.')
  })

  it('keeps the message of any other Error, and the fallback for a non-Error', () => {
    expect(apiErrorMessage(new Error('Network down'), 'Could not save.')).toBe('Network down')
    expect(apiErrorMessage('boom', 'Could not save.')).toBe('Could not save.')
  })
})
