/**
 * The shared per-document save machine (Document Mode and the standalone
 * document tab).
 */

import {
  absorbsFirstChange,
  AUTOSAVE_DEBOUNCE_MS,
  DocumentSaver,
  documentWriteOutcome,
  refusalMessage,
  type DocumentSaverOptions,
  type DocumentWriteOutcome,
} from '@/app/salon/[id]/hooks/document-saver'

type Doc = { filePath: string; mtime?: number }
type Saved = { mtime?: number }

function makeSaver(overrides: Partial<DocumentSaverOptions<Doc, Saved>> = {}) {
  const doc: Doc = { filePath: 'notes.txt', mtime: 1 }
  const options: DocumentSaverOptions<Doc, Saved> = {
    logPrefix: '[Test]',
    current: () => doc,
    write: jest.fn(async (): Promise<DocumentWriteOutcome<Saved>> => ({ kind: 'saved', data: { mtime: 2 } })),
    read: jest.fn(async () => ({ content: 'disk', mtime: 9 })),
    setSaving: jest.fn(),
    onSaved: jest.fn(),
    onConflict: jest.fn(),
    ...overrides,
  }
  const saver = new DocumentSaver<Doc, Saved>(() => options)
  saver.reset('v0', false)
  return { saver, options }
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('absorbsFirstChange', () => {
  it('absorbs only a non-empty Markdown load', () => {
    expect(absorbsFirstChange('a/notes.md', 'x')).toBe(true)
    expect(absorbsFirstChange('a/NOTES.MARKDOWN', 'x')).toBe(true)
    expect(absorbsFirstChange('a/notes.md', '')).toBe(false)
    expect(absorbsFirstChange('a/notes.txt', 'x')).toBe(false)
    expect(absorbsFirstChange('a/theme.json', 'x')).toBe(false)
  })
})

describe('DocumentSaver.change', () => {
  it('adopts the first change after an absorbing reset as the baseline', () => {
    const { saver } = makeSaver()
    saver.reset('# Hi', true)
    expect(saver.change('# Hi\n')).toBe('absorbed')
    expect(saver.savedContent).toBe('# Hi\n')
    expect(saver.hasUnsavedEdits()).toBe(false)
  })

  it('never absorbs a Source-view change, and autosaves it (#307)', () => {
    jest.useFakeTimers()
    const { saver, options } = makeSaver()
    saver.reset('# Hi', true)
    expect(saver.change('# Hi there', 'source')).toBe('dirty')
    expect(saver.savedContent).toBe('# Hi')
    expect(saver.hasUnsavedEdits()).toBe(true)
    jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS)
    expect(options.write).toHaveBeenCalledTimes(1)
  })

  it('a Source-view change spends the absorb flag, so a later editor change is an edit (#307)', () => {
    const { saver } = makeSaver()
    saver.reset('# Hi', true)
    saver.change('# Hi there', 'source')
    expect(saver.change('# Hi there, again')).toBe('dirty')
  })

  it('reports a return to the saved text as clean', () => {
    const { saver } = makeSaver()
    expect(saver.change('v1')).toBe('dirty')
    expect(saver.change('v0')).toBe('clean')
  })

  it('autosaves after the debounce', async () => {
    jest.useFakeTimers()
    const { saver, options } = makeSaver()
    saver.change('v1')
    jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS - 1)
    expect(options.write).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    expect(options.write).toHaveBeenCalledTimes(1)
  })

  it('cancelAutosave and dispose stop the timer', () => {
    jest.useFakeTimers()
    const { saver, options } = makeSaver()
    saver.change('v1')
    saver.dispose()
    jest.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS)
    expect(options.write).not.toHaveBeenCalled()
  })
})

describe('DocumentSaver.save', () => {
  it('resolves true at once with nothing unsaved', async () => {
    const { saver, options } = makeSaver()
    await expect(saver.save()).resolves.toBe(true)
    expect(options.write).not.toHaveBeenCalled()
  })

  it('writes text typed during the write in the same run, with the new mtime (#174)', async () => {
    let resolveFirst: (v: DocumentWriteOutcome<Saved>) => void = () => {}
    const write = jest.fn()
      .mockImplementationOnce(() => new Promise<DocumentWriteOutcome<Saved>>((r) => { resolveFirst = r }))
      .mockResolvedValueOnce({ kind: 'saved', data: { mtime: 3 } })
    const { saver, options } = makeSaver({ write })
    saver.change('v1')
    const first = saver.save()
    const joined = saver.save()
    expect(joined).toBe(first)
    saver.change('v2')
    resolveFirst({ kind: 'saved', data: { mtime: 2 } })
    await expect(first).resolves.toBe(true)
    expect(write.mock.calls.map(c => c[1])).toEqual([
      { content: 'v1', saved: 'v0', mtime: 1 },
      { content: 'v2', saved: 'v1', mtime: 2 },
    ])
    expect(options.onSaved).toHaveBeenNthCalledWith(1, 'v1', { mtime: 2 }, true)
    expect(options.onSaved).toHaveBeenNthCalledWith(2, 'v2', { mtime: 3 }, false)
    expect(options.setSaving).toHaveBeenNthCalledWith(1, true)
    expect(options.setSaving).toHaveBeenLastCalledWith(false)
  })

  it('resolves false on a refusal and keeps the edits', async () => {
    const { saver } = makeSaver({ write: jest.fn(async () => ({ kind: 'refused' as const, status: 500, body: 'x' })) })
    saver.change('v1')
    await expect(saver.save()).resolves.toBe(false)
    expect(saver.hasUnsavedEdits()).toBe(true)
  })

  it('resolves false when the write throws', async () => {
    const { saver } = makeSaver({ write: jest.fn(async () => { throw new Error('offline') }) })
    saver.change('v1')
    await expect(saver.save()).resolves.toBe(false)
  })

  it('on a conflict re-reads and reports, keeping unsaved edits (#175)', async () => {
    const { saver, options } = makeSaver({ write: jest.fn(async () => ({ kind: 'conflict' as const })) })
    saver.change('v1')
    await expect(saver.save()).resolves.toBe(false)
    expect(options.onConflict).toHaveBeenCalledWith({ filePath: 'notes.txt', mtime: 1 }, { content: 'disk', mtime: 9 }, true)
    expect(saver.hasUnsavedEdits()).toBe(true)
  })

  it('skips the conflict report when the re-read gives nothing', async () => {
    const { saver, options } = makeSaver({
      write: jest.fn(async () => ({ kind: 'conflict' as const })),
      read: jest.fn(async () => null),
    })
    saver.change('v1')
    await saver.save()
    expect(options.onConflict).not.toHaveBeenCalled()
  })

  it('flush writes only when something is unsaved', async () => {
    const { saver, options } = makeSaver()
    saver.flush()
    expect(options.write).not.toHaveBeenCalled()
    saver.change('v1')
    saver.flush()
    expect(options.write).toHaveBeenCalledTimes(1)
  })

  it('a saver configured later uses the configured options', async () => {
    const saver = new DocumentSaver<Doc, Saved>()
    const write = jest.fn(async (): Promise<DocumentWriteOutcome<Saved>> => ({ kind: 'saved', data: { mtime: 2 } }))
    saver.configure({
      logPrefix: '[Test]',
      current: () => ({ filePath: 'a.txt' }),
      write,
      read: async () => null,
      setSaving: () => {},
      onSaved: () => {},
      onConflict: () => {},
    })
    saver.reset('a', false)
    saver.change('b')
    await expect(saver.save()).resolves.toBe(true)
    expect(write).toHaveBeenCalledTimes(1)
  })
})

describe('documentWriteOutcome', () => {
  const res = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response

  it('reads a 409 as a conflict, other failures as refusals, and 2xx as saved', async () => {
    await expect(documentWriteOutcome(res(409, {}))).resolves.toEqual({ kind: 'conflict' })
    await expect(documentWriteOutcome(res(500, { error: 'no' }))).resolves.toEqual({
      kind: 'refused',
      status: 500,
      body: '{"error":"no"}',
    })
    await expect(documentWriteOutcome(res(200, { mtime: 4 }))).resolves.toEqual({ kind: 'saved', data: { mtime: 4 } })
  })
})

describe('DocumentSaver refusals (#352)', () => {
  it('calls onRefused with the status and body of a refused write', async () => {
    const onRefused = jest.fn()
    const { saver } = makeSaver({
      write: jest.fn(async (): Promise<DocumentWriteOutcome<Saved>> => ({ kind: 'refused', status: 400, body: '{"error":"Bad mount"}' })),
      onRefused,
    })
    saver.change('v1')
    expect(await saver.save()).toBe(false)
    expect(onRefused).toHaveBeenCalledWith({ filePath: 'notes.txt', mtime: 1 }, { status: 400, body: '{"error":"Bad mount"}' })
  })

  it('calls onRefused with status 0 when the request itself throws', async () => {
    const onRefused = jest.fn()
    const { saver } = makeSaver({ write: jest.fn(async () => { throw new Error('offline') }), onRefused })
    saver.change('v1')
    expect(await saver.save()).toBe(false)
    expect(onRefused).toHaveBeenCalledWith(expect.anything(), { status: 0, body: '' })
  })

  it('refusalMessage returns the server sentence, else the fallback', () => {
    expect(refusalMessage('{"error":"Nope"}', 'fb')).toBe('Nope')
    expect(refusalMessage('<html>', 'fb')).toBe('fb')
    expect(refusalMessage('', 'fb')).toBe('fb')
  })
})
