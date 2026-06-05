/**
 * Unit tests for ProviderOptionsPanel — the generic renderer that consumes
 * a provider plugin's getProviderOptionsSchema output.
 */

import { describe, it, expect, jest } from '@jest/globals'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import type { ProviderOptionsSchema } from '@quilltap/plugin-types'
import { ProviderOptionsPanel } from '@/components/settings/connection-profiles/ProviderOptionsPanel'

const SCHEMA: ProviderOptionsSchema = {
  groups: [
    {
      title: 'Test Options',
      helpText: 'Test help.',
      fields: [
        {
          key: 'aBool',
          label: 'A Boolean',
          type: 'boolean',
          default: false,
        },
        {
          key: 'anEnum',
          label: 'An Enum',
          type: 'enum',
          default: '',
          enumValues: [
            { value: '', label: '(default)' },
            { value: 'low', label: 'Low' },
            { value: 'high', label: 'High' },
          ],
        },
        {
          key: 'nestedEnum',
          label: 'Nested Enum',
          type: 'enum',
          default: 'x',
          enumValues: [
            { value: 'x', label: 'X' },
            { value: 'y', label: 'Y' },
          ],
          showIf: { field: 'aBool', equals: true },
        },
        {
          key: 'fallbacks',
          label: 'Fallbacks',
          type: 'multi-enum',
          multiEnumSource: 'fetchedModels',
          max: 2,
          default: [],
        },
        {
          key: 'directiveBool',
          label: 'Directive',
          type: 'boolean',
          default: false,
          affects: 'modelInput',
        },
      ],
    },
  ],
}

describe('ProviderOptionsPanel', () => {
  it('renders nothing when no schema is provided', () => {
    const { container } = render(
      <ProviderOptionsPanel
        schema={null}
        parameters={{}}
        fetchedModels={[]}
        onSetParameter={jest.fn()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders boolean and enum fields', () => {
    render(
      <ProviderOptionsPanel
        schema={SCHEMA}
        parameters={{}}
        fetchedModels={[]}
        onSetParameter={jest.fn()}
      />
    )
    expect(screen.getByLabelText('A Boolean')).toBeInTheDocument()
    expect(screen.getByLabelText('An Enum')).toBeInTheDocument()
  })

  it('hides showIf-guarded fields when the gate is false', () => {
    render(
      <ProviderOptionsPanel
        schema={SCHEMA}
        parameters={{ aBool: false }}
        fetchedModels={[]}
        onSetParameter={jest.fn()}
      />
    )
    expect(screen.queryByLabelText('Nested Enum')).not.toBeInTheDocument()
  })

  it('shows showIf-guarded fields when the gate is true', () => {
    render(
      <ProviderOptionsPanel
        schema={SCHEMA}
        parameters={{ aBool: true }}
        fetchedModels={[]}
        onSetParameter={jest.fn()}
      />
    )
    expect(screen.getByLabelText('Nested Enum')).toBeInTheDocument()
  })

  it('invokes onSetParameter when a boolean toggles', () => {
    const onSet = jest.fn()
    render(
      <ProviderOptionsPanel
        schema={SCHEMA}
        parameters={{}}
        fetchedModels={[]}
        onSetParameter={onSet}
      />
    )
    fireEvent.click(screen.getByLabelText('A Boolean'))
    expect(onSet).toHaveBeenCalledWith('aBool', true)
  })

  it('emits a directive callback for fields tagged with affects', () => {
    const onSet = jest.fn()
    const onDirective = jest.fn()
    render(
      <ProviderOptionsPanel
        schema={SCHEMA}
        parameters={{}}
        fetchedModels={[]}
        onSetParameter={onSet}
        onDirective={onDirective}
      />
    )
    fireEvent.click(screen.getByLabelText('Directive'))
    expect(onSet).toHaveBeenCalledWith('directiveBool', true)
    expect(onDirective).toHaveBeenCalledWith(
      'modelInput',
      expect.objectContaining({ key: 'directiveBool' }),
      true
    )
  })

  it('renders multi-enum entries from fetched models, capped at max', () => {
    const onSet = jest.fn()
    render(
      <ProviderOptionsPanel
        schema={SCHEMA}
        parameters={{ fallbacks: ['model-a', 'model-b'] }}
        fetchedModels={['model-a', 'model-b', 'model-c']}
        modelName="model-current"
        onSetParameter={onSet}
      />
    )
    const checkboxC = screen.getByRole('checkbox', { name: /model-c/i })
    expect(checkboxC).toBeDisabled()
    const checkboxA = screen.getByRole('checkbox', { name: /model-a/i })
    fireEvent.click(checkboxA)
    expect(onSet).toHaveBeenCalledWith('fallbacks', ['model-b'])
  })

  it('skips multi-enum choice equal to the active modelName', () => {
    render(
      <ProviderOptionsPanel
        schema={SCHEMA}
        parameters={{}}
        fetchedModels={['model-a', 'model-b']}
        modelName="model-a"
        onSetParameter={jest.fn()}
      />
    )
    expect(screen.queryByRole('checkbox', { name: /model-a/i })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /model-b/i })).toBeInTheDocument()
  })
})
