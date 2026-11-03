/**
 * Storyteller — the bid and plan sections, and the shared-stream controllers.
 */

import { buildBidSection, buildPlanSection, describeDisposition } from '../prompts'
import { sharedStreamController, sinkController } from '../sse-tag'
import { parseBidReply } from '../bid-parse'

const encoder = new TextEncoder()

describe('buildBidSection', () => {
  const offer = {
    tools: { search: 'read' as const, doc_write_file: 'write' as const },
    customTools: { peek: 'read' as const },
    destroyOffered: false,
    silent: true,
  }

  it('is a turn note asking for the labelled format', () => {
    const text = buildBidSection({ characterName: 'Riya', talkativeness: 0.2, offer })
    expect(text).toMatch(/^\[Turn note from the Salon/)
    expect(text).toContain('BID: speak or pass')
    expect(text).toContain("PLAN: one or two sentences, in Riya's own words")
    expect(text).toContain('Read-only tools: search.')
    expect(text).toContain('peek: read (lookup tier)')
    expect(text).toContain('only act or emote')
    expect(text).toContain(describeDisposition(0.2))
  })

  it('offers Destroy only when a destroy tool is on the menu', () => {
    expect(buildBidSection({ characterName: 'R', talkativeness: 0.5, offer })).not.toContain('- destroy:')
    expect(buildBidSection({
      characterName: 'R', talkativeness: 0.5,
      offer: { ...offer, tools: { ...offer.tools, doc_delete_file: 'destroy' }, destroyOffered: true },
    })).toContain('- destroy: delete something (doc_delete_file)')
  })

  it('asks for a reply the parser reads', () => {
    expect(parseBidReply('BID: speak\nTIER: lookup\nTOOLS: search\nPLAN: x')).not.toBeNull()
  })
})

describe('buildPlanSection', () => {
  it('names the plan, who spoke since, the pass and the allowance', () => {
    const text = buildPlanSection({
      plan: 'I check the ledger.', tier: 'lookup', toolsNamed: ['search'],
      spokenSince: ['Lorian', 'Riya'], allowedTools: ['search', 'doc_read_file'],
    })
    expect(text).toContain('"I check the ledger."')
    expect(text).toContain('Lorian and Riya have spoken')
    expect(text).toContain('[NOTHING TO ADD]')
    expect(text).toContain('read-only tools')
    expect(text).toContain('do not announce it, quote it')
  })

  it('a re-roll offers neither tools nor a pass', () => {
    const text = buildPlanSection({ plan: 'p', tier: 'act', toolsNamed: [], spokenSince: [], allowedTools: [], reroll: true })
    expect(text).not.toContain('[NOTHING TO ADD]')
    expect(text).not.toContain('Tools available')
  })
})

describe('sharedStreamController', () => {
  it('forwards what it is given and ignores close', () => {
    const enqueued: Uint8Array[] = []
    const inner = { desiredSize: 1, enqueue: (c: Uint8Array) => enqueued.push(c), close: jest.fn(), error: jest.fn() }
    const shared = sharedStreamController(inner as unknown as ReadableStreamDefaultController<Uint8Array>)
    const chunk = encoder.encode('data: {}\n\n')
    shared.enqueue(chunk)
    shared.close()
    expect(enqueued).toEqual([chunk])
    expect(inner.close).not.toHaveBeenCalled()
  })

  it('a sink discards everything', () => {
    const sink = sinkController()
    expect(() => { sink.enqueue(encoder.encode('x')); sink.close() }).not.toThrow()
  })
})
