import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals'

// Mock the logger so we don't need the full logging infrastructure
jest.mock('@/lib/logging/create-logger', () => ({
  createLogger: () => ({
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  }),
}))

// Use fake timers to avoid real sleep delays
jest.useFakeTimers()

const { withFsRetry } = require('@/lib/file-storage/backends/local/retry')

function makeNodeError(code: string, errno?: number): NodeJS.ErrnoException {
  const err = new Error(`${code}`) as NodeJS.ErrnoException
  err.code = code
  if (errno !== undefined) err.errno = errno
  return err
}

describe('withFsRetry', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.clearAllTimers()
  })

  it('returns the result of the operation on first success', async () => {
    const op = jest.fn<() => Promise<string>>().mockResolvedValue('ok')
    const result = await withFsRetry(op, { operation: 'read' })
    expect(result).toBe('ok')
    expect(op).toHaveBeenCalledTimes(1)
  })

  it('rethrows non-transient errors immediately without retry', async () => {
    const err = makeNodeError('ENOENT')
    const op = jest.fn<() => Promise<never>>().mockRejectedValue(err)
    await expect(
      withFsRetry(op, { operation: 'read' }),
    ).rejects.toBe(err)
    expect(op).toHaveBeenCalledTimes(1)
  })

  it('retries on EAGAIN and succeeds on second attempt', async () => {
    const eagain = makeNodeError('EAGAIN')
    const op = jest.fn<() => Promise<string>>()
      .mockRejectedValueOnce(eagain)
      .mockResolvedValue('recovered')

    const promise = withFsRetry(op, { operation: 'download' })
    // Advance timers past the first backoff (50 ms)
    await jest.advanceTimersByTimeAsync(100)
    const result = await promise
    expect(result).toBe('recovered')
    expect(op).toHaveBeenCalledTimes(2)
  })

  it('retries on EBUSY', async () => {
    const ebusy = makeNodeError('EBUSY')
    const op = jest.fn<() => Promise<string>>()
      .mockRejectedValueOnce(ebusy)
      .mockResolvedValue('ok')

    const promise = withFsRetry(op, { operation: 'upload' })
    await jest.advanceTimersByTimeAsync(100)
    const result = await promise
    expect(result).toBe('ok')
    expect(op).toHaveBeenCalledTimes(2)
  })

  it('retries on EDEADLK', async () => {
    const edeadlk = makeNodeError('EDEADLK')
    const op = jest.fn<() => Promise<string>>()
      .mockRejectedValueOnce(edeadlk)
      .mockResolvedValue('ok')

    const promise = withFsRetry(op, { operation: 'read' })
    await jest.advanceTimersByTimeAsync(100)
    const result = await promise
    expect(result).toBe('ok')
    expect(op).toHaveBeenCalledTimes(2)
  })

  it('retries on numeric errno -35 (EDEADLK on Linux)', async () => {
    // libuv surfaces this without a named code
    const err = makeNodeError('Unknown system error -35', -35)
    const op = jest.fn<() => Promise<string>>()
      .mockRejectedValueOnce(err)
      .mockResolvedValue('ok')

    const promise = withFsRetry(op, { operation: 'read' })
    await jest.advanceTimersByTimeAsync(100)
    const result = await promise
    expect(result).toBe('ok')
    expect(op).toHaveBeenCalledTimes(2)
  })

  it('retries on EINTR', async () => {
    const eintr = makeNodeError('EINTR')
    const op = jest.fn<() => Promise<string>>()
      .mockRejectedValueOnce(eintr)
      .mockResolvedValue('ok')

    const promise = withFsRetry(op, { operation: 'read' })
    await jest.advanceTimersByTimeAsync(100)
    const result = await promise
    expect(result).toBe('ok')
    expect(op).toHaveBeenCalledTimes(2)
  })

  it('exhausts retries and rethrows the last transient error', async () => {
    const eagain = makeNodeError('EAGAIN')
    const op = jest.fn<() => Promise<never>>().mockRejectedValue(eagain)

    // Attach the rejection expectation before advancing timers so the promise
    // rejection is always handled and the test framework doesn't flag it.
    const expectRejects = expect(withFsRetry(op, { operation: 'read' })).rejects.toBe(eagain)
    // Advance past all 5 backoffs: 50+150+400+800+1500 = 2900 ms
    await jest.advanceTimersByTimeAsync(5000)
    await expectRejects
    // 6 total attempts (1 initial + 5 retries)
    expect(op).toHaveBeenCalledTimes(6)
  })

  it('passes context key to log context', async () => {
    // Just verifying no crash when key is provided alongside operation
    const op = jest.fn<() => Promise<string>>().mockResolvedValue('ok')
    const result = await withFsRetry(op, { operation: 'read', key: 'some/path/file.png' })
    expect(result).toBe('ok')
  })

  it('does not treat non-object errors as transient', async () => {
    const op = jest.fn<() => Promise<never>>().mockRejectedValue('string-error')
    await expect(withFsRetry(op, { operation: 'read' })).rejects.toBe('string-error')
    expect(op).toHaveBeenCalledTimes(1)
  })
})
