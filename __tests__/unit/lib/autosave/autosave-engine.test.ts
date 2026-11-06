/**
 * The character page's autosave engine (lib/autosave/autosave-engine.ts):
 * idle debounce, commit-on-blur, flush, coalescing, one request in flight,
 * failure keeps the text, retry, validation and immediate controls.
 */

import { AutosaveEngine } from '@/lib/autosave/autosave-engine'

function setup(save = jest.fn().mockResolvedValue(undefined)) {
  const engine = new AutosaveEngine({
    save,
    idleMs: 1500,
    commitDelayMs: 50,
    labelFor: (key) => key.toUpperCase(),
    validate: (key, value) => (key === 'name' && value === '' ? 'A character must have a name.' : null),
  })
  return { engine, save }
}

describe('AutosaveEngine', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('sends a prose draft only after the idle delay, never per keystroke', async () => {
    const { engine, save } = setup()
    engine.setDraft('personality', 'B', { idle: true })
    jest.advanceTimersByTime(1000)
    engine.setDraft('personality', 'Br', { idle: true })
    jest.advanceTimersByTime(1000)
    expect(save).not.toHaveBeenCalled()
    expect(engine.getStatus()).toEqual({ state: 'saving' })
    jest.advanceTimersByTime(600)
    await Promise.resolve()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ personality: 'Br' }, { keepalive: false })
  })

  it('holds a short-text draft until it is committed (blur / Enter)', async () => {
    const { engine, save } = setup()
    engine.setDraft('title', 'the rival')
    jest.advanceTimersByTime(5000)
    expect(save).not.toHaveBeenCalled()
    expect(engine.getStatus()).toEqual({ state: 'editing' })
    engine.commit()
    jest.advanceTimersByTime(60)
    await Promise.resolve()
    expect(save).toHaveBeenCalledWith({ title: 'the rival' }, { keepalive: false })
  })

  it('coalesces every pending field into one save', async () => {
    const { engine, save } = setup()
    engine.setDraft('title', 'T')
    engine.setDraft('identity', 'I', { idle: true })
    await engine.flush()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ title: 'T', identity: 'I' }, { keepalive: false })
    expect(engine.hasPending()).toBe(false)
    expect(engine.getStatus()).toEqual({ state: 'saved' })
  })

  it('passes keepalive through for the unload flush', async () => {
    const { engine, save } = setup()
    engine.setDraft('title', 'T')
    await engine.flush({ keepalive: true })
    expect(save).toHaveBeenCalledWith({ title: 'T' }, { keepalive: true })
  })

  it('keeps a keystroke made during the round trip and sends it next', async () => {
    let release!: () => void
    const save = jest
      .fn()
      .mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
      .mockResolvedValue(undefined)
    const { engine } = setup(save)
    engine.setDraft('description', 'one')
    const first = engine.flush()
    engine.setDraft('description', 'one two')
    const second = engine.flush() // asked for while one is in flight
    expect(save).toHaveBeenCalledTimes(1)
    release()
    await first
    await second
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith({ description: 'one two' }, { keepalive: false })
    expect(engine.hasDraft('description')).toBe(false)
  })

  it('keeps the text on failure, names the field, and retries', async () => {
    const save = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)
    const { engine } = setup(save)
    engine.setDraft('personality', 'Brave')
    await engine.flush()
    expect(engine.draftOf('personality')).toBe('Brave')
    expect(engine.hasFailed('personality')).toBe(true)
    expect(engine.getStatus()).toEqual({ state: 'error', label: 'PERSONALITY' })
    await engine.retry()
    expect(save).toHaveBeenCalledTimes(2)
    expect(engine.hasFailed('personality')).toBe(false)
    expect(engine.getStatus()).toEqual({ state: 'saved' })
  })

  it('holds back a draft that fails validation (an empty name) and says why', async () => {
    const { engine, save } = setup()
    engine.setDraft('name', '')
    engine.setDraft('title', 'T')
    await engine.flush()
    expect(save).toHaveBeenCalledWith({ title: 'T' }, { keepalive: false })
    expect(engine.hasDraft('name')).toBe(true)
    expect(engine.invalidReason('name')).toBe('A character must have a name.')
  })

  it('discards a draft that went back to the stored value', () => {
    const { engine } = setup()
    engine.setDraft('title', 'x')
    engine.discard('title')
    expect(engine.hasPending()).toBe(false)
    expect(engine.getStatus()).toEqual({ state: 'saved' })
  })

  it('reports an immediate control as saving while it runs, and re-throws its failure', async () => {
    const { engine } = setup()
    let release!: () => void
    const pending = engine.runImmediate(() => new Promise<void>((r) => (release = r)))
    expect(engine.getStatus()).toEqual({ state: 'saving' })
    release()
    await pending
    expect(engine.getStatus()).toEqual({ state: 'saved' })
    await expect(engine.runImmediate(() => Promise.reject(new Error('no')))).rejects.toThrow('no')
    expect(engine.getStatus()).toEqual({ state: 'saved' })
  })

  it('notifies subscribers and keeps a stable status snapshot between changes', () => {
    const { engine } = setup()
    const listener = jest.fn()
    const unsubscribe = engine.subscribe(listener)
    engine.setDraft('title', 'x')
    expect(listener).toHaveBeenCalled()
    const editing = engine.getStatus()
    engine.setDraft('title', 'xy')
    expect(engine.getStatus()).toBe(editing)
    engine.discard('title')
    expect(engine.getStatus()).toEqual({ state: 'saved' })
    unsubscribe()
  })
})
