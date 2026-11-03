'use client'

/**
 * SlashCommandPlugin
 *
 * Type `/` at the start of a word and a menu of commands opens beneath the
 * cursor: the composer's own actions (attach, library, image, announce, mail,
 * inform, the dice), Prospero's user-invocable tools, and Pascal's custom tools
 * for this chat. Enter, Tab or a click takes the highlighted command; the
 * `/query` leaves the composer in one undoable step, and then the command runs —
 * at once when a tool has nothing to complete, otherwise in its existing dialog,
 * opened straight onto that tool's form.
 *
 * Which commands exist, where a trigger starts and how matches rank are all
 * decided in `lib/slash-commands/`; this file asks and applies. Space is not a
 * commit key — commands take no arguments, so a space simply closes the menu and
 * leaves the text as prose.
 *
 * Mounted only in the Salon composer (never Document Mode) and only while the
 * `composerSlashCommands` chat setting is on. Both lists are fetched only while
 * the menu is open, so a composer that never sees a `/` never asks.
 *
 * @module components/chat/lexical/plugins/SlashCommandPlugin
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { GuardedTypeaheadMenuPlugin } from '../typeahead/GuardedTypeaheadMenuPlugin'
import type { MenuRenderFn, MenuTextMatch } from '@lexical/react/LexicalTypeaheadMenuPlugin'
import {
  COMMAND_PRIORITY_CRITICAL,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalEditor,
  type TextNode,
} from 'lexical'

import { Icon } from '@/components/ui/icon'
import type { IconName } from '@/components/ui/icon'
import { useChatSettingsQuery } from '@/hooks/useChatSettingsQuery'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import {
  buildSlashCommands,
  findSlashTrigger,
  rankSlashCommands,
  type ComposerAction,
  type SlashBuiltInToolSource,
  type SlashCommand,
  type SlashCustomToolSource,
} from '@/lib/slash-commands'
import { TypeaheadOption, useTypeaheadShell, toMenuTextMatch } from '../typeahead/useTypeaheadShell'
import { $textBeforeCursor, $isGluedToPreviousRun } from '../typeahead/trigger-context'
import type { SlashCommandContext } from '../slash-commands/context'

/** Rows for a typed query; a bare `/` lists everything and the menu scrolls. */
const MENU_LIMIT = 12

/**
 * Update tag for the trigger removal. Deliberately NOT `HISTORY_MERGE_TAG`:
 * merging would fold the removal into the typing that produced `/query`, so an
 * undo would take the whole word away instead of bringing it back.
 */
const SLASH_COMMAND_TAG = 'slash-command-commit'

const LISTBOX_ID = 'slash-command-listbox'
const EMPTY_LABEL = 'No such command'
const LOADING_LABEL = 'Consulting the tool room…'

/** Actions derived from the dialog openers rather than the composer's handler map. */
const DIALOG_ACTIONS: ReadonlySet<ComposerAction> = new Set(['tool', 'roll', 'pascal'])

const ACTION_ICONS: Partial<Record<ComposerAction, IconName>> = {
  attach: 'paperclip',
  library: 'file-plus',
  image: 'camera',
  announce: 'megaphone',
  mail: 'mail',
  inform: 'info',
  deus: 'deus-ex-machina',
  tool: 'wrench',
  pascal: 'wand',
}

function glyphFor(command: SlashCommand): JSX.Element {
  let name: IconName = 'dice'
  if (command.payload.kind === 'builtin-tool') name = 'wrench'
  else if (command.payload.kind === 'custom-tool') name = 'wand'
  else name = ACTION_ICONS[command.payload.action] ?? 'dice'
  return <Icon name={name} className="w-4 h-4" />
}

interface ToolsResponse {
  tools?: SlashBuiltInToolSource[]
}

interface CustomToolsResponse {
  tools?: SlashCustomToolSource[]
}

/** Run a picked command against the composer's handlers. */
function dispatchSlashCommand(command: SlashCommand, context: SlashCommandContext): void {
  const { payload } = command
  switch (payload.kind) {
    case 'action':
      if (payload.action === 'tool') context.openRunTool()
      else if (payload.action === 'roll') context.openRunTool('rng')
      else if (payload.action === 'pascal') context.openCustomTool()
      else context.actions[payload.action]?.()
      return
    case 'builtin-tool':
      if (command.needsDialog) context.openRunTool(payload.toolId)
      else void context.runBuiltInNow(payload.toolId)
      return
    case 'custom-tool': {
      const tool = { name: payload.name, asCharacterId: payload.asCharacterId }
      if (command.needsDialog) context.openCustomTool(tool)
      else void context.runCustomNow(tool)
      return
    }
  }
}

/**
 * Holds Enter and Tab while the lists are still loading and nothing matches, so
 * `/self_inv` + Enter typed before the tools arrive does not send the draft.
 * Escape closes the menu and releases both keys.
 */
function HoldCommitKeys({ editor }: { editor: LexicalEditor }): null {
  useEffect(() => {
    const hold = (event: KeyboardEvent | null) => {
      event?.preventDefault()
      return true
    }
    const releaseEnter = editor.registerCommand(KEY_ENTER_COMMAND, hold, COMMAND_PRIORITY_CRITICAL)
    const releaseTab = editor.registerCommand(KEY_TAB_COMMAND, hold, COMMAND_PRIORITY_CRITICAL)
    return () => {
      releaseEnter()
      releaseTab()
    }
  }, [editor])
  return null
}

export interface SlashCommandPluginProps {
  context: SlashCommandContext
}

export function SlashCommandPlugin({ context }: Readonly<SlashCommandPluginProps>): JSX.Element | null {
  const { data: chatSettings } = useChatSettingsQuery()
  const enabled = chatSettings?.composerSlashCommands ?? true
  if (!enabled) return null
  return <SlashCommandMenu context={context} />
}

function SlashCommandMenu({ context }: Readonly<SlashCommandPluginProps>): JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [query, setQuery] = useState<string | null>(null)
  const [rootElement, setRootElement] = useState<HTMLElement | null>(null)
  const menuOpen = query !== null
  const { chatId, customToolsAvailable } = context

  // The handlers change identity with the composer's renders; the select path
  // reads the latest through a ref rather than re-creating the menu.
  const contextRef = useRef(context)
  useEffect(() => {
    contextRef.current = context
  }, [context])

  useEffect(() => editor.registerRootListener((next) => setRootElement(next)), [editor])

  const builtInQuery = useQuery({
    queryKey: queryKeys.tools.byChat(chatId),
    queryFn: ({ signal }) =>
      apiFetch<ToolsResponse>(`/api/v1/tools?chatId=${chatId}&includeSchemas=true`, { signal }),
    enabled: menuOpen,
    staleTime: 60_000,
  })

  // Same key as the custom-tool dialog and the Salon's gutter gate. Fresh per
  // open, as the key's own doc-comment asks: stale at once, refetched whenever
  // the menu opens.
  const customQuery = useQuery({
    queryKey: queryKeys.customTools.byChat(chatId),
    queryFn: ({ signal }) =>
      apiFetch<CustomToolsResponse>(`/api/v1/chats/${chatId}/custom-tools`, { signal }),
    enabled: menuOpen && customToolsAvailable,
    staleTime: 0,
  })

  const actionKeys = Object.keys(context.actions).join('|')
  const commands = useMemo(() => {
    const wired = (actionKeys ? actionKeys.split('|') : []) as ComposerAction[]
    const actions = new Set<ComposerAction>(wired.filter((action) => !DIALOG_ACTIONS.has(action)))
    actions.add('tool')
    actions.add('roll')
    if (customToolsAvailable) actions.add('pascal')
    return buildSlashCommands({
      actions,
      builtInTools: builtInQuery.data?.tools ?? [],
      customTools: customToolsAvailable ? customQuery.data?.tools ?? [] : [],
    })
  }, [actionKeys, customToolsAvailable, builtInQuery.data, customQuery.data])

  const options = useMemo(() => {
    if (query === null) return []
    return rankSlashCommands(commands, query, MENU_LIMIT).map(
      (command) =>
        new TypeaheadOption<SlashCommand>(
          {
            key: command.key,
            glyph: glyphFor(command),
            label: `/${command.command} — ${command.label}`,
            detail: command.source,
          },
          command,
        ),
    )
  }, [commands, query])

  const triggerFn = useCallback((text: string, activeEditor: LexicalEditor): MenuTextMatch | null => {
    if (activeEditor.isComposing()) return null

    const match = findSlashTrigger(text)
    if (!match) return null

    const current = $textBeforeCursor()
    if (!current) return null
    if ($isGluedToPreviousRun(current.node, match.start)) return null

    return toMenuTextMatch(text, match)
  }, [])

  const onSelectOption = useCallback(
    (option: TypeaheadOption<SlashCommand>, nodeToReplace: TextNode | null, closeMenu: () => void) => {
      const command = option.payload
      editor.update(
        () => {
          // The node Lexical split off holds exactly `/query`. Removing it
          // leaves an emptied paragraph in place, caret and all.
          nodeToReplace?.remove()
        },
        {
          tag: SLASH_COMMAND_TAG,
          // Dispatch after the commit, so a dialog opening never races the
          // editor's own selection restore.
          onUpdate: () => dispatchSlashCommand(command, contextRef.current),
        },
      )
      closeMenu()
    },
    [editor],
  )

  // Only a list with nothing in it yet is "loading" — cached tools show at once.
  const loading =
    (builtInQuery.isPending && !builtInQuery.data) ||
    (customToolsAvailable && customQuery.isPending && !customQuery.data)
  const shellRenderFn = useTypeaheadShell<SlashCommand>({
    listboxId: LISTBOX_ID,
    emptyLabel: loading ? LOADING_LABEL : EMPTY_LABEL,
    activeDescendantTarget: rootElement,
  })

  const menuRenderFn = useCallback<MenuRenderFn<TypeaheadOption<SlashCommand>>>(
    (anchorElementRef, itemProps, matchingString) => (
      <>
        {loading && itemProps.options.length === 0 && <HoldCommitKeys editor={editor} />}
        {shellRenderFn(anchorElementRef, itemProps, matchingString)}
      </>
    ),
    [editor, shellRenderFn, loading],
  )

  return (
    <GuardedTypeaheadMenuPlugin<TypeaheadOption<SlashCommand>>
      options={options}
      onQueryChange={setQuery}
      onSelectOption={onSelectOption}
      triggerFn={triggerFn}
      menuRenderFn={menuRenderFn}
      commandPriority={COMMAND_PRIORITY_CRITICAL}
    />
  )
}

export default SlashCommandPlugin
