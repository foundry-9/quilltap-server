/**
 * Tool effects — the resolver and the tool-list ceiling filter.
 */

import {
  effectOfToolCall,
  maxEffectOfTool,
  highestToolEffect,
  describeCeilingRefusal,
  resolveToolPermit,
  offeredTools,
  OPERATOR_TOOL_OFFER,
} from '../effects'
import { lowerToolEffect, isWithinCeiling } from '../effect-types'
import { customToolEffect } from '@/lib/pascal/tool-effect'

describe('effect resolution', () => {
  it('reads static, computed and plugin effects', () => {
    expect(effectOfToolCall('doc_read_file', {})).toBe('read')
    expect(effectOfToolCall('state', { operation: 'fetch' })).toBe('read')
    expect(effectOfToolCall('mcp_x', {}, { pluginToolEffects: new Map([['mcp_x', 'read']]) })).toBe('read')
    expect(effectOfToolCall('mcp_unknown', {})).toBe('write')
  })

  it('takes the maximum of a computed tool', () => {
    expect(maxEffectOfTool('state')).toBe('write')
    expect(maxEffectOfTool('doc_delete_file')).toBe('destroy')
  })

  it('ranks and lowers ceilings', () => {
    expect(highestToolEffect(['read', 'none', 'write'])).toBe('write')
    expect(highestToolEffect([])).toBe('none')
    expect(lowerToolEffect(undefined, 'write')).toBe('write')
    expect(lowerToolEffect('read', 'write')).toBe('read')
    expect(isWithinCeiling('destroy', 'write')).toBe(false)
    expect(describeCeilingRefusal('x', 'write', 'none')).toMatch(/no effect/)
  })
})

describe('customToolEffect (D5)', () => {
  it('is read without effects and write with any', () => {
    expect(customToolEffect({ effects: undefined })).toBe('read')
    expect(customToolEffect({ effects: [] })).toBe('read')
    expect(customToolEffect({ effects: [{ target: 'state.a', value: 1 }] as never })).toBe('write')
    expect(customToolEffect({ effects: [{ log: 'it happened' }] as never })).toBe('write')
  })
})

describe('resolveToolPermit', () => {
  it('refuses a built-in tool that was not offered', () => {
    const permit = resolveToolPermit('inventory_give', {}, { offer: offeredTools(['inventory_list']) })
    expect(permit).toMatchObject({ permitted: false, refusal: 'not-offered' })
  })

  it('admits an offered tool within the ceiling', () => {
    const permit = resolveToolPermit('doc_read_file', { path: 'a.md' }, {
      offer: offeredTools(['doc_read_file']),
      effectCeiling: 'read',
    })
    expect(permit).toEqual({ permitted: true, effect: 'read' })
  })

  it('refuses an offered tool above the ceiling with the ceiling message', () => {
    const permit = resolveToolPermit('doc_write_file', { path: 'a.md', content: 'x' }, {
      offer: offeredTools(['doc_write_file']),
      effectCeiling: 'read',
    })
    expect(permit).toMatchObject({ permitted: false, refusal: 'above-ceiling', effect: 'write' })
    if (!permit.permitted) expect(permit.message).toMatch(/allows only lookups/)
  })

  it('lets an operator run skip membership but not the ceiling', () => {
    expect(resolveToolPermit('rng', { type: 'd6' }, { offer: OPERATOR_TOOL_OFFER }).permitted).toBe(true)
    const capped = resolveToolPermit('doc_delete_file', { path: 'a.md' }, { offer: OPERATOR_TOOL_OFFER, effectCeiling: 'write' })
    expect(capped).toMatchObject({ permitted: false, refusal: 'above-ceiling' })
  })

  it('holds operator-surface tools to the operator surface whatever the offer', () => {
    const offer = offeredTools(['run_sql', 'lookup_memories'])
    expect(resolveToolPermit('run_sql', { sql: 'SELECT 1' }, { offer })).toMatchObject({ refusal: 'operator-surface-only' })
    expect(resolveToolPermit('lookup_memories', {}, { offer: OPERATOR_TOOL_OFFER })).toMatchObject({ refusal: 'operator-surface-only' })
    expect(resolveToolPermit('run_sql', { sql: 'SELECT 1' }, { offer, operatorSurface: true }).permitted).toBe(true)
  })

  it('refuses everything without an offer', () => {
    expect(resolveToolPermit('rng', {}, { offer: undefined })).toMatchObject({ permitted: false, refusal: 'no-offer' })
  })
})

describe('doc_open_document effect', () => {
  it('is a read only when a non-empty path is named', () => {
    expect(effectOfToolCall('doc_open_document', { path: 'Notes/a.md' })).toBe('read')
    expect(effectOfToolCall('doc_open_document', { uri: 'qtap://general/Notes/a.md' })).toBe('read')
  })

  it('is a write for a path-less uri, a blank path, or no path', () => {
    expect(effectOfToolCall('doc_open_document', { uri: 'qtap://general' })).toBe('write')
    expect(effectOfToolCall('doc_open_document', { uri: 'qtap://general/' })).toBe('write')
    expect(effectOfToolCall('doc_open_document', { path: '  ' })).toBe('write')
    expect(effectOfToolCall('doc_open_document', {})).toBe('write')
  })

  it('is a write when the uri does not parse', () => {
    expect(effectOfToolCall('doc_open_document', { uri: 'qtap:///a.md' })).toBe('write')
  })
})
