/**
 * Composer punctuation warnings — the Lexical adapter.
 *
 * The rules are pinned by the engine's corpus (`lib/punctuation-lint/__tests__`),
 * so this suite proves only what the adapter adds: that the editor is turned into
 * the right blocks, that the painted ranges land on the right DOM characters, that
 * the text is never touched, and that the setting turns it off.
 *
 * jsdom has no CSS Custom Highlight API, so a minimal stand-in records what the
 * plugin publishes.
 */

import { PunctuationLintPlugin, PUNCTUATION_HIGHLIGHT_NAME } from '@/components/chat/lexical/plugins/PunctuationLintPlugin'

import React from 'react'
import { act } from '@testing-library/react'
import { $createParagraphNode, $createTextNode, $getRoot, $createLineBreakNode } from 'lexical'

import {
  renderPluginEditor,
  seedParagraph,
  seedCodeBlock,
  readText,
  flush,
  type PluginHarness,
} from '../../../../../helpers/lexicalPluginHarness'

class FakeHighlight {
  ranges: Range[]
  constructor(...ranges: Range[]) {
    this.ranges = ranges
  }
}

const registry = new Map<string, FakeHighlight>()

/** The characters currently painted, in document order. */
function paintedText(): string[] {
  return (registry.get(PUNCTUATION_HIGHLIGHT_NAME)?.ranges ?? []).map((r) => r.toString())
}

describe('PunctuationLintPlugin', () => {
  let harness: PluginHarness
  const realFetch = global.fetch

  beforeAll(() => {
    ;(globalThis as unknown as { Highlight: typeof FakeHighlight }).Highlight = FakeHighlight
    Object.defineProperty(CSS, 'highlights', { value: registry, configurable: true })
  })

  beforeEach(() => {
    registry.clear()
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{}',
    })) as unknown as typeof fetch
    jest.spyOn(console, 'debug').mockImplementation(() => {})
  })

  afterEach(() => {
    harness?.unmount()
    global.fetch = realFetch
    jest.restoreAllMocks()
  })

  function mount(settings?: Record<string, unknown>) {
    harness = renderPluginEditor(<PunctuationLintPlugin />, settings ? { chatSettings: settings } : {})
  }

  it('paints a double quote opened inside open dialogue, and nothing else', () => {
    mount()
    act(() => seedParagraph(harness.editor, '"He told me "go away" and left."'))
    expect(paintedText()).toEqual(['"', '"'])
    const ranges = registry.get(PUNCTUATION_HIGHLIGHT_NAME)!.ranges
    expect(ranges[0].startOffset).toBe(12)
    expect(ranges[1].startOffset).toBe(20)
  })

  it('never changes the text', () => {
    mount()
    const text = '"He told me "go away" and *left.'
    act(() => seedParagraph(harness.editor, text))
    expect(paintedText().length).toBeGreaterThan(0)
    expect(readText(harness.editor)).toBe(text)
  })

  it('clears the paint once the mistake is fixed', () => {
    mount()
    act(() => seedParagraph(harness.editor, '"He told me "go away" and left."'))
    expect(paintedText()).toHaveLength(2)
    act(() => seedParagraph(harness.editor, '"He told me \'go away\' and left."'))
    expect(registry.has(PUNCTUATION_HIGHLIGHT_NAME)).toBe(false)
  })

  it('does not flag an opener the caret has just typed', () => {
    mount()
    act(() => seedParagraph(harness.editor, 'He said "'))
    expect(paintedText()).toEqual([])
  })

  it('maps offsets across text nodes and soft line breaks', () => {
    mount()
    act(() => {
      harness.editor.update(
        () => {
          const root = $getRoot()
          root.clear()
          const paragraph = $createParagraphNode()
          const bold = $createTextNode('"Bold')
          bold.setFormat('bold')
          paragraph.append(bold, $createLineBreakNode(), $createTextNode('then "nested" and done."'))
          root.append(paragraph)
          root.selectStart()
        },
        { discrete: true },
      )
    })
    flush(harness.editor)
    const ranges = registry.get(PUNCTUATION_HIGHLIGHT_NAME)!.ranges
    expect(ranges.map((r) => [r.startContainer.textContent, r.startOffset])).toEqual([
      ['then "nested" and done."', 5],
      ['then "nested" and done."', 12],
    ])
  })

  it('leaves code blocks alone', () => {
    mount()
    act(() => seedCodeBlock(harness.editor, 'echo "a "b" c"'))
    expect(paintedText()).toEqual([])
  })

  it('paints nothing when the setting is off', () => {
    mount({ smartTypographySettings: { punctuationWarnings: false } })
    act(() => seedParagraph(harness.editor, '"He told me "go away" and left."'))
    expect(paintedText()).toEqual([])
  })
})
