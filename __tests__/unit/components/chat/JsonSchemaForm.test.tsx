import { render, screen, fireEvent } from '@testing-library/react'
import React, { useState } from 'react'
import JsonSchemaForm from '@/components/chat/JsonSchemaForm'

function Harness({ schema, onState }: { schema: any; onState: (s: { values: Record<string, unknown>; valid: boolean }) => void }) {
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [valid, setValid] = useState(false)
  onState({ values, valid })
  return <JsonSchemaForm schema={schema} values={values} onChange={setValues} onValidChange={setValid} />
}

describe('JsonSchemaForm', () => {
  it('treats a required boolean with no default as false, not missing (#289)', () => {
    let state: any
    render(
      <Harness
        schema={{ type: 'object', properties: { flag: { type: 'boolean' } }, required: ['flag'] }}
        onState={s => { state = s }}
      />,
    )
    expect(state.valid).toBe(true)
    expect(state.values).toEqual({ flag: false })
  })

  it('reports invalid while an object field holds unparseable JSON (#289)', () => {
    let state: any
    render(
      <Harness
        schema={{ type: 'object', properties: { data: { type: 'object' } }, required: ['data'] }}
        onState={s => { state = s }}
      />,
    )
    const box = screen.getByPlaceholderText('Enter valid JSON...')
    fireEvent.change(box, { target: { value: '{' } })
    expect(state.valid).toBe(false)
    fireEvent.change(box, { target: { value: '{"a":1}' } })
    expect(state.valid).toBe(true)
    expect(state.values.data).toEqual({ a: 1 })
  })
})
