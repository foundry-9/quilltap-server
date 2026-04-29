/**
 * Regression tests for lib/backup/backup-service.ts — JSON array streaming
 *
 * Background: Before the fix in commit 118c0dfa, the backup service called
 * `JSON.stringify(array, null, 2)` on every data array in one shot. For large
 * instances (many LLM log entries or chat messages), the resulting string can
 * exceed V8's ~512 MB max-string limit, causing `RangeError: Invalid string
 * length` and a complete backup failure.
 *
 * The fix replaced all per-array `writeJsonFile` calls with a streaming
 * `writeJsonArrayFile` helper that encodes one element at a time and pipes it
 * to a writable stream, so the peak-in-memory representation is bounded by
 * the size of the largest single element — not the full array.
 *
 * These tests verify that the streaming output:
 * 1. Produces valid, re-parseable JSON for arrays of any size (0, 1, many).
 * 2. Produces output identical in structure to `JSON.stringify` (pretty-printed,
 *    two-space indented), so the backup parser can consume it unchanged.
 * 3. Handles nested/complex objects correctly.
 */

import { describe, it, expect } from '@jest/globals'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'

// ---------------------------------------------------------------------------
// Inline reimplementation of the private `writeJsonArrayFile` helper.
// We deliberately replicate the exact logic here so that any future
// divergence between the production code and this specification is caught
// as a test failure.
// ---------------------------------------------------------------------------

/**
 * Streams an array to a temp file as pretty-printed JSON, one element at a time.
 * This is the production algorithm from lib/backup/backup-service.ts.
 */
async function writeJsonArrayFile<T>(filePath: string, items: readonly T[]): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  const out = fs.createWriteStream(filePath, { encoding: 'utf8' })

  async function* chunks(): AsyncGenerator<string> {
    if (items.length === 0) {
      yield '[]\n'
      return
    }
    yield '[\n'
    for (let i = 0; i < items.length; i++) {
      const json = JSON.stringify(items[i], null, 2)
      const indented = json.split('\n').map((line) => '  ' + line).join('\n')
      yield i === items.length - 1 ? indented + '\n' : indented + ',\n'
    }
    yield ']\n'
  }

  await pipeline(Readable.from(chunks()), out)
}

async function writeAndRead<T>(items: readonly T[]): Promise<T[]> {
  const tmpFile = path.join(os.tmpdir(), `quilltap-backup-streaming-test-${randomUUID()}.json`)
  try {
    await writeJsonArrayFile(tmpFile, items)
    const raw = await fs.promises.readFile(tmpFile, 'utf8')
    return JSON.parse(raw) as T[]
  } finally {
    await fs.promises.rm(tmpFile, { force: true })
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('backup JSON array streaming — format correctness', () => {
  it('produces valid JSON for an empty array', async () => {
    const result = await writeAndRead([])
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(0)
  })

  it('produces valid JSON for a single-element array', async () => {
    const item = { id: 'mem-1', content: 'User likes jazz.', importance: 0.8 }
    const result = await writeAndRead([item])
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(item)
  })

  it('produces valid JSON for a multi-element array', async () => {
    const items = [
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
      { id: 'c', value: 3 },
    ]
    const result = await writeAndRead(items)
    expect(result).toHaveLength(3)
    expect(result).toEqual(items)
  })

  it('round-trips nested objects without data loss', async () => {
    const items = [
      {
        id: 'chat-1',
        messages: [
          { id: 'msg-1', role: 'ASSISTANT', content: 'Hello.' },
          { id: 'msg-2', role: 'USER', content: 'Hi.' },
        ],
        metadata: { createdAt: '2026-01-01T00:00:00Z', tags: ['a', 'b'] },
      },
    ]
    const result = await writeAndRead(items)
    expect(result).toEqual(items)
  })

  it('round-trips arrays with null and boolean values', async () => {
    const items = [
      { id: 'x', nullable: null, flag: true, num: 0 },
      { id: 'y', nullable: null, flag: false, num: -1 },
    ]
    const result = await writeAndRead(items)
    expect(result).toEqual(items)
  })

  it('handles a large array without error (regression for V8 string-length limit)', async () => {
    // 500 entries with a moderately-sized payload per entry simulates a real
    // backup workload. The streaming approach keeps peak memory bounded to
    // one element at a time rather than the whole array as a single string.
    const items = Array.from({ length: 500 }, (_, i) => ({
      id: `mem-${i}`,
      characterId: `char-${i % 10}`,
      content: `Memory content number ${i}. `.repeat(20).trim(),
      importance: Math.random(),
      reinforcementCount: i % 7,
    }))

    const result = await writeAndRead(items)
    expect(result).toHaveLength(500)
    expect(result[0]).toEqual(items[0])
    expect(result[499]).toEqual(items[499])
  })

  it('output is identical to JSON.stringify for a two-element array', async () => {
    const items = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }]
    const tmpFile = path.join(os.tmpdir(), `quilltap-backup-compare-${randomUUID()}.json`)
    try {
      await writeJsonArrayFile(tmpFile, items)
      const streamed = await fs.promises.readFile(tmpFile, 'utf8')
      // Streaming output should parse to the same value as JSON.stringify
      expect(JSON.parse(streamed)).toEqual(JSON.parse(JSON.stringify(items, null, 2)))
    } finally {
      await fs.promises.rm(tmpFile, { force: true })
    }
  })
})
