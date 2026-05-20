import { canonicalizeUniversalTool, canonicalizeUniversalTools } from '@/lib/tools/canonicalize'
import type { UniversalTool } from '@/lib/plugins/interfaces/tool-plugin'

function makeTool(name: string, parameters: Record<string, unknown> = { type: 'object', properties: {}, required: [] }): UniversalTool {
  return {
    type: 'function',
    function: {
      name,
      description: `desc-${name}`,
      parameters: parameters as UniversalTool['function']['parameters'],
    },
  }
}

describe('canonicalizeUniversalTools', () => {
  it('sorts tools alphabetically by name', () => {
    const result = canonicalizeUniversalTools([
      makeTool('zebra'),
      makeTool('alpha'),
      makeTool('mango'),
    ])
    expect(result.map(t => t.function.name)).toEqual(['alpha', 'mango', 'zebra'])
  })

  it('produces byte-identical output for equivalent inputs in different orders', () => {
    const a = canonicalizeUniversalTools([
      makeTool('zebra'),
      makeTool('alpha'),
      makeTool('mango'),
    ])
    const b = canonicalizeUniversalTools([
      makeTool('alpha'),
      makeTool('mango'),
      makeTool('zebra'),
    ])
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('recursively sorts JSON-Schema property keys', () => {
    const schemaA = {
      type: 'object',
      properties: {
        zoo: { type: 'string' },
        apple: { type: 'number' },
        banana: { type: 'boolean' },
      },
      required: ['zoo', 'apple'],
    }
    const schemaB = {
      properties: {
        banana: { type: 'boolean' },
        zoo: { type: 'string' },
        apple: { type: 'number' },
      },
      required: ['zoo', 'apple'],
      type: 'object',
    }
    const a = canonicalizeUniversalTool(makeTool('thing', schemaA))
    const b = canonicalizeUniversalTool(makeTool('thing', schemaB))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('preserves required-array order (it is itself a list, not a key set)', () => {
    const tool = canonicalizeUniversalTool(makeTool('thing', {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
      required: ['b', 'a'],
    }))
    // sortKeysDeep maps array elements but does not sort them — required stays as-is
    expect(tool.function.parameters.required).toEqual(['b', 'a'])
  })
})
