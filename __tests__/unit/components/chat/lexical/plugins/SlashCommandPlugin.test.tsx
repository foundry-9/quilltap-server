/**
 * The composer's `/` command menu, against a REAL Lexical editor.
 *
 * Trigger, ranking and registry rules are pinned in `lib/slash-commands/__tests__`;
 * this suite is about the wiring — that the menu opens and narrows, that a pick
 * removes the typed `/query` in one undoable step and then dispatches to the
 * right handler, and that prose and the setting keep it shut.
 */

import React from 'react'
import { act, screen } from '@testing-library/react'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  UNDO_COMMAND,
  type LexicalEditor,
} from 'lexical'

import { SlashCommandPlugin } from '@/components/chat/lexical/plugins/SlashCommandPlugin'
import type { SlashCommandContext } from '@/components/chat/lexical/slash-commands/context'
import { renderPluginEditor, readText, flush, type PluginHarness } from '../../../../../helpers/lexicalPluginHarness'

const zeroRect = () =>
  ({ x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect
const realRangeRect = Range.prototype.getBoundingClientRect
const realRangeRects = Range.prototype.getClientRects
const realResizeObserver = global.ResizeObserver
const realFetch = global.fetch

const BUILT_INS = [
  { id: 'self_inventory', name: 'Self Inventory', description: 'Look in your pockets', category: 'utility', parameters: { type: 'object', properties: {} } },
  { id: 'wardrobe_wear', name: 'Wear Wardrobe Items', description: 'Put things on', category: 'wardrobe', parameters: { type: 'object', properties: { operations: { type: 'array' } } } },
  { id: 'generate_image', name: 'Generate Image', description: 'Paint', available: false, unavailableReason: 'no profile' },
]

const ROSTER = [
  { name: 'unlock', title: 'Force the Lock', description: 'Pick it', parameters: { bonus: { type: 'number' } }, asCharacterId: 'char-1' },
  { name: 'wear_regalia', title: 'Wear Regalia', description: 'Dress up', parameters: {}, asCharacterId: 'char-1' },
]

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response
}

beforeAll(() => {
  Range.prototype.getBoundingClientRect = zeroRect
  Range.prototype.getClientRects = (() => []) as unknown as Range['getClientRects']
  ;(Node.prototype as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = zeroRect
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/custom-tools')) return jsonResponse({ tools: ROSTER, errors: [] })
    if (url.startsWith('/api/v1/tools')) return jsonResponse({ tools: BUILT_INS })
    return jsonResponse({})
  }) as unknown as typeof fetch
})

afterAll(() => {
  Range.prototype.getBoundingClientRect = realRangeRect
  Range.prototype.getClientRects = realRangeRects
  delete (Node.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect
  global.ResizeObserver = realResizeObserver
  global.fetch = realFetch
})

function makeContext(): SlashCommandContext & {
  actions: Record<string, jest.Mock>
  openRunTool: jest.Mock
  openCustomTool: jest.Mock
  runBuiltInNow: jest.Mock
  runCustomNow: jest.Mock
} {
  return {
    chatId: 'chat-1',
    actions: { attach: jest.fn(), library: jest.fn(), inform: jest.fn(), d20: jest.fn() },
    openRunTool: jest.fn(),
    openCustomTool: jest.fn(),
    runBuiltInNow: jest.fn(async () => {}),
    runCustomNow: jest.fn(async () => {}),
    customToolsAvailable: true,
  }
}

describe('SlashCommandPlugin', () => {
  let harness: PluginHarness
  let context: ReturnType<typeof makeContext>

  afterEach(() => harness?.unmount())

  function mount(chatSettings: Record<string, boolean> = { composerSlashCommands: true }): LexicalEditor {
    context = makeContext()
    harness = renderPluginEditor(<SlashCommandPlugin context={context} />, { chatSettings })
    harness.editor.getRootElement()?.focus()
    return harness.editor
  }

  function seed(editor: LexicalEditor, text: string) {
    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        const paragraph = $createParagraphNode()
        if (text) paragraph.append($createTextNode(text))
        root.append(paragraph)
        paragraph.selectEnd()
      },
      { discrete: true },
    )
  }

  async function settle() {
    for (let i = 0; i < 6; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
      })
    }
  }

  async function openMenu(editor: LexicalEditor, text: string) {
    seed(editor, text)
    await settle()
  }

  async function press(editor: LexicalEditor, command: typeof KEY_ENTER_COMMAND | typeof KEY_ESCAPE_COMMAND) {
    const event = new KeyboardEvent('keydown', { cancelable: true })
    act(() => {
      editor.dispatchCommand(command, event)
    })
    flush(editor)
    await settle()
    return event.defaultPrevented
  }

  function optionLabels() {
    return screen.queryAllByRole('option').map((option) => option.textContent ?? '')
  }

  describe('the menu', () => {
    it('opens on a bare / with actions, custom tools and available built-ins', async () => {
      const editor = mount()
      await openMenu(editor, '/')
      const labels = optionLabels()
      expect(labels.some((l) => l.includes('/attach'))).toBe(true)
      expect(labels.some((l) => l.includes('/unlock'))).toBe(true)
      expect(labels.some((l) => l.includes('/wardrobe_wear'))).toBe(true)
      expect(labels.some((l) => l.includes('/generate_image'))).toBe(false)
      expect(labels.some((l) => l.includes('/pascal'))).toBe(true)
    })

    it('narrows as the writer types', async () => {
      const editor = mount()
      await openMenu(editor, 'then /un')
      expect(optionLabels()).toEqual([expect.stringContaining('/unlock')])
    })

    it('finds a tool by a word of its id', async () => {
      const editor = mount()
      await openMenu(editor, '/wear')
      expect(optionLabels()[0]).toContain('/wear_regalia')
      expect(optionLabels().some((l) => l.includes('/wardrobe_wear'))).toBe(true)
    })

    it.each(['and/or', '10/15', 'see http://x'])('stays shut in prose: %j', async (text) => {
      const editor = mount()
      await openMenu(editor, text)
      expect(screen.queryAllByRole('option')).toHaveLength(0)
    })

    it('never mounts while the setting is off', async () => {
      const editor = mount({ composerSlashCommands: false })
      await openMenu(editor, '/att')
      expect(screen.queryAllByRole('option')).toHaveLength(0)
      // Enter reaches the editor (a new paragraph here; a send in the composer).
      await press(editor, KEY_ENTER_COMMAND)
      expect(readText(editor).startsWith('/att')).toBe(true)
      expect(context.actions.attach).not.toHaveBeenCalled()
    })
  })

  describe('picking a command', () => {
    it('Enter removes the typed text and runs the action', async () => {
      const editor = mount()
      await openMenu(editor, '/atta')
      expect(await press(editor, KEY_ENTER_COMMAND)).toBe(true)
      expect(readText(editor)).toBe('')
      expect(context.actions.attach).toHaveBeenCalledTimes(1)
    })

    it('keeps the surrounding text', async () => {
      const editor = mount()
      await openMenu(editor, 'hello /infor')
      await press(editor, KEY_ENTER_COMMAND)
      expect(readText(editor)).toBe('hello ')
      expect(context.actions.inform).toHaveBeenCalledTimes(1)
    })

    it('one undo brings the typed text back', async () => {
      const editor = mount()
      await openMenu(editor, '/atta')
      await press(editor, KEY_ENTER_COMMAND)
      act(() => {
        editor.dispatchCommand(UNDO_COMMAND, undefined)
      })
      flush(editor)
      expect(readText(editor)).toBe('/atta')
    })

    it('Escape closes the menu and leaves the text', async () => {
      const editor = mount()
      await openMenu(editor, '/atta')
      await press(editor, KEY_ESCAPE_COMMAND)
      expect(screen.queryAllByRole('option')).toHaveLength(0)
      expect(readText(editor)).toBe('/atta')
      expect(context.actions.attach).not.toHaveBeenCalled()
    })

    it('opens Run Tool on the form of a built-in with parameters', async () => {
      const editor = mount()
      await openMenu(editor, '/wardrobe_w')
      await press(editor, KEY_ENTER_COMMAND)
      expect(context.openRunTool).toHaveBeenCalledWith('wardrobe_wear')
      expect(context.runBuiltInNow).not.toHaveBeenCalled()
    })

    it('runs a built-in with no parameters at once', async () => {
      const editor = mount()
      await openMenu(editor, '/self_inventory')
      await press(editor, KEY_ENTER_COMMAND)
      expect(context.runBuiltInNow).toHaveBeenCalledWith('self_inventory')
      expect(context.openRunTool).not.toHaveBeenCalled()
    })

    it('opens the custom-tool dialog for a Pascal tool with parameters', async () => {
      const editor = mount()
      await openMenu(editor, '/unlock')
      await press(editor, KEY_ENTER_COMMAND)
      expect(context.openCustomTool).toHaveBeenCalledWith({ name: 'unlock', asCharacterId: 'char-1' })
    })

    it('runs a Pascal tool with no parameters at once', async () => {
      const editor = mount()
      await openMenu(editor, '/wear_regalia')
      await press(editor, KEY_ENTER_COMMAND)
      expect(context.runCustomNow).toHaveBeenCalledWith({ name: 'wear_regalia', asCharacterId: 'char-1' })
    })

    it('/roll opens Run Tool on rng; /d20 is the quick roll', async () => {
      const editor = mount()
      await openMenu(editor, '/roll')
      await press(editor, KEY_ENTER_COMMAND)
      expect(context.openRunTool).toHaveBeenCalledWith('rng')

      await openMenu(editor, '/d20')
      await press(editor, KEY_ENTER_COMMAND)
      expect(context.actions.d20).toHaveBeenCalledTimes(1)
    })
  })
})
