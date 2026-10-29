/**
 * Tool effects — the resolver and the tool-list ceiling filter.
 */

import { effectOfToolCall, maxEffectOfTool, highestToolEffect, describeCeilingRefusal } from '../effects'
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
