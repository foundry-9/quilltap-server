/**
 * Writing Assistant context remap across import / restore: by kind, missing
 * targets dropped, General kept.
 */

import { remapConsoleContext } from '../context-remap'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const NEW_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NEW_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

describe('remapConsoleContext', () => {
  it('remaps each ref by its kind and drops a missing target', () => {
    const calls: Array<[string, string]> = []
    const out = remapConsoleContext(
      [{ kind: 'chat', id: A }, { kind: 'project', id: B }, { kind: 'store', id: C }, { kind: 'general' }],
      (kind, id) => {
        calls.push([kind, id])
        if (kind === 'chat' && id === A) return NEW_A
        if (kind === 'store' && id === C) return NEW_C
        return null
      },
    )
    expect(out).toEqual([{ kind: 'chat', id: NEW_A }, { kind: 'store', id: NEW_C }, { kind: 'general' }])
    expect(calls).toEqual([['chat', A], ['project', B], ['store', C]])
  })

  it('reads a JSON-encoded column', () => {
    expect(remapConsoleContext(JSON.stringify([{ kind: 'chat', id: A }]), () => NEW_A)).toEqual([{ kind: 'chat', id: NEW_A }])
  })

  it('drops unparseable entries and answers null for no context', () => {
    expect(remapConsoleContext([{ kind: 'bogus', id: A }, { kind: 'chat' }], () => NEW_A)).toEqual([])
    expect(remapConsoleContext(null, () => NEW_A)).toBeNull()
    expect(remapConsoleContext('not json', () => NEW_A)).toBeNull()
  })
})
