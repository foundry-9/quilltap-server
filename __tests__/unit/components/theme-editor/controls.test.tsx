/**
 * Calliope's Atelier — the typed value controls (Calliope Live, Spec E,
 * Stage 2): each shows a parsed value, writes a formatted one when changed,
 * and falls to the text form — leaving the value alone — for one its parser
 * does not read.
 */

// Uses global jest (not @jest/globals) so the jest-dom matcher augmentation
// resolves on the global `expect` under tsc.
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { DraftResourcesContext, ValueControl, type ControlProps } from '@/components/theme-editor/controls'
import { draftResources } from '@/components/theme-editor/model'
import { formatShadow, parseShadow } from '@/lib/themes/engine/client'

function show(props: Partial<ControlProps> & Pick<ControlProps, 'type' | 'value'>, resources = draftResources(null, [])) {
  const onCommit = jest.fn()
  const all: ControlProps = { label: 'Thing, light', literal: props.value, onCommit, ...props }
  const view = render(
    <DraftResourcesContext.Provider value={resources}>
      <ValueControl {...all} />
    </DraftResourcesContext.Provider>,
  )
  return { onCommit, ...view }
}

const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('the edit-as-text frame', () => {
  it('shows a value its parser cannot read as text, with a word why, and leaves it alone', () => {
    const { onCommit } = show({ type: 'length', value: 'clamp(1px, 2vw, 3px)' })
    expect(screen.getByLabelText('Thing, light value')).toHaveValue('clamp(1px, 2vw, 3px)')
    expect(screen.getByText(/beyond the controls/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Thing, light, amount')).not.toBeInTheDocument()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('switches between the controls and the text', () => {
    show({ type: 'length', value: '2px' })
    fireEvent.click(screen.getByRole('button', { name: 'Thing, light: edit as text' }))
    expect(screen.getByLabelText('Thing, light value')).toHaveValue('2px')
    fireEvent.click(screen.getByRole('button', { name: 'Thing, light: use the controls' }))
    expect(screen.getByLabelText('Thing, light, amount')).toHaveValue(2)
  })

  it('starts an unset token from its placeholder and writes nothing until changed', () => {
    const { onCommit } = show({ type: 'length', value: '', literal: null, placeholder: '4px' })
    expect(screen.getByLabelText('Thing, light, amount')).toHaveValue(4)
    expect(onCommit).not.toHaveBeenCalled()
    change('Thing, light, amount', '5')
    expect(onCommit).toHaveBeenCalledWith('5px')
  })
})

describe('a value that follows another', () => {
  it('starts the controls from what it comes to, and changing one writes a value of its own', () => {
    const { onCommit } = show({ type: 'shadow', value: 'var(--p-card-shadow)', literal: '0 1px 2px #000' })
    expect(screen.queryByText(/beyond the controls/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Thing, light, layer 1, down, amount')).toHaveValue(1)
    expect(onCommit).not.toHaveBeenCalled()
    change('Thing, light, layer 1, down, amount', '3')
    expect(onCommit).toHaveBeenLastCalledWith('0 3px 2px #000')
  })
})

describe('length and radius', () => {
  it('writes a number and a unit', () => {
    const { onCommit } = show({ type: 'length', value: '2px' })
    change('Thing, light, amount', '3')
    expect(onCommit).toHaveBeenLastCalledWith('3px')
    change('Thing, light, unit', 'rem')
    expect(onCommit).toHaveBeenLastCalledWith('2rem')
    change('Thing, light, unit', 'kw:auto')
    expect(onCommit).toHaveBeenLastCalledWith('auto')
  })

  it('edits one corner of a radius, and joins them again', () => {
    const { onCommit } = show({ type: 'radius', value: '4px 8px' })
    expect(screen.getByLabelText('Thing, light, top right, amount')).toHaveValue(8)
    change('Thing, light, top left, amount', '6')
    expect(onCommit).toHaveBeenLastCalledWith('6px 8px 4px')
    fireEvent.click(screen.getByLabelText('Each corner its own'))
    expect(onCommit).toHaveBeenLastCalledWith('4px')
  })
})

describe('shadow', () => {
  const value = '0 2px 6px rgb(0 0 0 / 0.15)'

  it('edits a layer, adds one, and says none', () => {
    const { onCommit } = show({ type: 'shadow', value })
    expect(screen.getByLabelText('Thing, light, layer 1, down, amount')).toHaveValue(2)
    change('Thing, light, layer 1, down, amount', '4')
    expect(onCommit).toHaveBeenLastCalledWith('0 4px 6px rgb(0 0 0 / 0.15)')
    fireEvent.click(screen.getByRole('button', { name: /Add a layer/ }))
    expect(parseShadow(onCommit.mock.lastCall![0])!.layers).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: /No shadow/ }))
    expect(onCommit).toHaveBeenLastCalledWith('none')
  })

  it('writes a formatted value equal to what the engine formats', () => {
    const { onCommit } = show({ type: 'shadow', value })
    fireEvent.click(screen.getByLabelText('Inset'))
    const expected = parseShadow(value)!
    expect(onCommit).toHaveBeenLastCalledWith(formatShadow({ layers: [{ ...expected.layers[0], inset: true }] }))
  })
})

describe('font family', () => {
  it('reorders, removes, adds a stack and shows a sample', () => {
    const { onCommit } = show({ type: 'font-family', value: '"Brass Serif", serif' })
    expect(screen.getByText(/The butler, unflappable/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Move serif in Thing, light up' }))
    expect(onCommit).toHaveBeenLastCalledWith('serif, "Brass Serif"')
    fireEvent.click(screen.getByRole('button', { name: 'Remove serif in Thing, light' }))
    expect(onCommit).toHaveBeenLastCalledWith('"Brass Serif"')
    change('Thing, light, add a font', 'stack:4')
    expect(onCommit).toHaveBeenLastCalledWith('"Brass Serif", serif, cursive')
  })

  it("offers the draft's fonts", () => {
    const { onCommit } = show({ type: 'font-family', value: 'serif' }, draftResources({ fonts: [{ family: 'Brass Serif' }] }, []))
    change('Thing, light, add a font', 'font:Brass Serif')
    expect(onCommit).toHaveBeenLastCalledWith('serif, "Brass Serif"')
  })
})

describe('font weight', () => {
  it("marks the weights the theme's font declares", () => {
    const { onCommit } = show(
      { type: 'font-weight', value: '700', familyInForce: 'Brass Serif' },
      draftResources({ fonts: [{ family: 'Brass Serif', weight: '400 700' }] }, []),
    )
    expect(screen.getByRole('option', { name: /600 Semibold — the theme's font has it/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '900 Black' })).toBeInTheDocument()
    change('Thing, light weight', 'bold')
    expect(onCommit).toHaveBeenLastCalledWith('bold')
  })
})

describe('keyword and font style', () => {
  it('chooses from the options', () => {
    const { onCommit } = show({ type: 'font-style', value: 'italic', options: ['normal', 'italic', 'oblique'] })
    expect(screen.getByLabelText('Thing, light choice')).toHaveValue('italic')
    change('Thing, light choice', 'normal')
    expect(onCommit).toHaveBeenLastCalledWith('normal')
  })
})

describe('duration and transition', () => {
  it('writes a duration', () => {
    const { onCommit } = show({ type: 'duration', value: '150ms' })
    change('Thing, light, unit', 's')
    expect(onCommit).toHaveBeenLastCalledWith('150s')
  })

  it('edits a transition and drops a zero delay', () => {
    const { onCommit } = show({ type: 'transition', value: 'opacity 150ms ease 50ms' })
    expect(screen.getByLabelText('Thing, light, transition 1, property')).toHaveValue('opacity')
    change('Thing, light, transition 1, delay, amount', '0')
    expect(onCommit).toHaveBeenLastCalledWith('opacity 150ms ease')
    fireEvent.click(screen.getByRole('button', { name: /No transition/ }))
    expect(onCommit).toHaveBeenLastCalledWith('none')
  })
})

describe('opacity, blur, image and z-index', () => {
  it('moves opacity by its slider and by its field', () => {
    const { onCommit } = show({ type: 'opacity', value: '0.5' })
    change('Thing, light, slider', '80')
    expect(onCommit).toHaveBeenLastCalledWith('0.8')
    change('Thing, light, written as', '%')
    expect(onCommit).toHaveBeenLastCalledWith('50%')
  })

  it('turns blur off', () => {
    const { onCommit } = show({ type: 'blur', value: 'blur(8px)' })
    expect(screen.getByLabelText('Thing, light blur, amount')).toHaveValue(8)
    fireEvent.click(screen.getByLabelText(/No blur/))
    expect(onCommit).toHaveBeenLastCalledWith('none')
  })

  it("picks one of the draft's images", () => {
    const { onCommit } = show({ type: 'image', value: 'none' }, draftResources(null, [{ path: 'images/paper.webp', url: '/files/paper.webp' }]))
    change('Thing, light image', 'images/paper.webp')
    expect(onCommit).toHaveBeenLastCalledWith("url('images/paper.webp')")
  })

  it('sets a layer or auto', () => {
    const { onCommit } = show({ type: 'z-index', value: '10' })
    change('Thing, light, layer', '20')
    expect(onCommit).toHaveBeenLastCalledWith('20')
    fireEvent.click(screen.getByLabelText(/Auto/))
    expect(onCommit).toHaveBeenLastCalledWith('auto')
  })
})

describe('the text form', () => {
  it('refuses a colour it does not recognise', () => {
    const { onCommit } = show({ type: 'color', value: '#123456' })
    change('Thing, light value', 'mauve-ish')
    fireEvent.blur(screen.getByLabelText('Thing, light value'))
    expect(screen.getByText(/Not a colour the atelier recognises/)).toBeInTheDocument()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('is the control for raw values', () => {
    const { onCommit } = show({ type: 'raw', value: 'anything at all' })
    change('Thing, light value', 'something else')
    fireEvent.blur(screen.getByLabelText('Thing, light value'))
    expect(onCommit).toHaveBeenCalledWith('something else')
  })
})
