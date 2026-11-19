/**
 * What a navigation item does when chosen, mapped by item id.
 *
 * The registry (`lib/navigation/registry.ts`) says *what* the items are; this
 * file says what choosing one does — the way `components/settings/cards.tsx`
 * maps a settings card's body. A rail click, a flyout row and a native menu
 * click (`window.quilltap.onNavigate`) all run the same activator, so they
 * cannot behave differently.
 *
 * - Every action has an activator (`ACTION_ACTIVATORS` is a full record, so
 *   the compiler refuses a missing one).
 * - A destination's default is "open its tab in the workspace, else load
 *   `href`". Brahma, Wardrobe, Inventory and the Atlas keep their dialogs
 *   outside the workspace, and the last three open chat-scoped from a Salon
 *   chat.
 *
 * Framework-free apart from the provider values handed in by
 * `use-nav-activate.ts`, which builds the context.
 *
 * @module components/layout/left-sidebar/activators
 */

import type { QueryClient } from '@tanstack/react-query'
import { parseHrefToIntent } from '@/lib/navigation/route-to-intent'
import type { NavActionId, NavItem, NavItemId } from '@/lib/navigation/registry'
import { chatProjectIdQuery } from '@/lib/hooks/use-character-wardrobe-items'
import type { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import type { useHelpChatOptional } from '@/components/providers/help-chat-provider'
import type { useBrahmaConsoleOptional } from '@/components/providers/brahma-console-provider'
import type { useWardrobeDialogOptional } from '@/components/providers/wardrobe-dialog-provider'
import type { useInventoryDialogOptional } from '@/components/providers/inventory-dialog-provider'
import type { useAtlasDialogOptional } from '@/components/providers/atlas-dialog-provider'
import type { useNewChatModalOptional } from '@/components/providers/new-chat-provider'

/** A panel the rail opens in a flyout rather than a page. */
export type NavPanelId = 'themes' | 'quick-hide'

export interface NavActivatorContext {
  item: NavItem<NavItemId>
  /** The workspace store, when the workspace surface is the page on show; else null. */
  workspace: NonNullable<ReturnType<typeof useWorkspaceOptional>> | null
  pathname: string | null
  /** A full navigation, for when there is no workspace to open a tab in. */
  navigate: (href: string) => void
  helpChat: ReturnType<typeof useHelpChatOptional>
  brahmaConsole: ReturnType<typeof useBrahmaConsoleOptional>
  wardrobeDialog: ReturnType<typeof useWardrobeDialogOptional>
  inventoryDialog: ReturnType<typeof useInventoryDialogOptional>
  atlasDialog: ReturnType<typeof useAtlasDialogOptional>
  newChat: ReturnType<typeof useNewChatModalOptional>
  queryClient: QueryClient
  openPanel: (panel: NavPanelId) => void
  openDocumentPicker: () => void
}

export type NavActivator = (ctx: NavActivatorContext) => void | Promise<void>

/** Whether an item can be chosen now, and why not when it cannot. */
export interface NavAvailability {
  disabled: boolean
  reason?: string
}

// Match a UUID immediately following /salon/: from a Salon chat, the Wardrobe,
// Inventory and Atlas dialogs open against that chat.
const SALON_CHAT_PATH_RE = /^\/salon\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/

function salonChatIdOf(pathname: string | null): string | null {
  return pathname?.match(SALON_CHAT_PATH_RE)?.[1] ?? null
}

interface SalonParticipantLite {
  id: string
  controlledBy?: string | null
  displayOrder?: number | null
  character?: { id?: string | null } | null
}

interface MessageLite {
  role?: string | null
  participantId?: string | null
}

/**
 * The dialog's default character for a chat: the last character to speak who
 * is not user-controlled, else the first such character in chat order, else
 * null (the dialog falls back to the alphabetical first).
 */
async function resolveDefaultCharacterForChat(chatId: string): Promise<string | null> {
  try {
    const [chatRes, msgRes] = await Promise.all([
      fetch(`/api/v1/chats/${chatId}`, { cache: 'no-store' }),
      fetch(`/api/v1/messages?chatId=${chatId}`, { cache: 'no-store' }),
    ])
    if (!chatRes.ok) return null
    const chatData = (await chatRes.json()) as { chat?: { participants?: SalonParticipantLite[] } }
    const eligible = (chatData.chat?.participants ?? []).filter((p) => p.controlledBy !== 'user' && p.character?.id)
    if (eligible.length === 0) return null

    if (msgRes.ok) {
      const msgData = (await msgRes.json()) as { messages?: MessageLite[] }
      const messages = msgData.messages ?? []
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]
        if (m.role !== 'assistant' || !m.participantId) continue
        const cid = eligible.find((p) => p.id === m.participantId)?.character?.id
        if (cid) return cid
      }
    }

    const byOrder = [...eligible].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
    return byOrder[0]?.character?.id ?? null
  } catch (error) {
    console.warn('[nav] Could not resolve the chat\'s default character', { chatId, error })
    return null
  }
}

/** Open the item's tab in the workspace; with no workspace on show, load its href. */
export const openDestination: NavActivator = (ctx) => {
  const { target } = ctx.item
  if (target.type !== 'destination') return
  if (ctx.workspace) {
    // `/workspace?open=<kind>` hrefs have no route to parse: the declared kind is the tab.
    const intent = parseHrefToIntent(target.href)
    ctx.workspace.openTab(intent?.kind ?? target.tabKind, intent?.payload)
    return
  }
  ctx.navigate(target.href)
}

/** Every action's behaviour. A full record: a new action id will not compile without one. */
export const ACTION_ACTIVATORS: Record<NavActionId, NavActivator> = {
  help: (ctx) => {
    if (!ctx.helpChat || !ctx.helpChat.isEligible) return
    ctx.helpChat.openHelpChat()
  },
  'new-chat': (ctx) => {
    if (ctx.newChat) ctx.newChat.open()
    else ctx.navigate('/salon/new')
  },
  'open-document': (ctx) => ctx.openDocumentPicker(),
  themes: (ctx) => ctx.openPanel('themes'),
  'quick-hide': (ctx) => ctx.openPanel('quick-hide'),
}

/** Destinations whose behaviour is not the default. */
export const DESTINATION_ACTIVATORS: Partial<Record<NavItemId, NavActivator>> = {
  brahma: (ctx) => {
    if (ctx.brahmaConsole && !ctx.brahmaConsole.isEligible) return
    if (ctx.workspace || !ctx.brahmaConsole) return openDestination(ctx)
    ctx.brahmaConsole.openConsole()
  },
  wardrobe: async (ctx) => {
    if (ctx.workspace || !ctx.wardrobeDialog) return openDestination(ctx)
    const chatId = salonChatIdOf(ctx.pathname)
    if (!chatId) return ctx.wardrobeDialog.open()
    const characterId = await resolveDefaultCharacterForChat(chatId)
    ctx.wardrobeDialog.open(characterId ? { chatId, characterId } : { chatId })
  },
  inventory: async (ctx) => {
    if (ctx.workspace || !ctx.inventoryDialog) return openDestination(ctx)
    const chatId = salonChatIdOf(ctx.pathname)
    if (!chatId) return ctx.inventoryDialog.open()
    const characterId = await resolveDefaultCharacterForChat(chatId)
    ctx.inventoryDialog.open(characterId ? { chatId, characterId } : { chatId })
  },
  atlas: async (ctx) => {
    // From a Salon chat the dialog opens on the chat's project (General when
    // it has none); elsewhere on General.
    if (ctx.workspace || !ctx.atlasDialog) return openDestination(ctx)
    const chatId = salonChatIdOf(ctx.pathname)
    if (!chatId) return ctx.atlasDialog.open()
    let projectId: string | null = null
    try {
      projectId = await ctx.queryClient.fetchQuery(chatProjectIdQuery(chatId))
    } catch (error) {
      console.warn('[nav] Could not read the chat\'s project for the Atlas', { chatId, error })
    }
    ctx.atlasDialog.open(projectId ? { chatId, projectId } : { chatId })
  },
}

/** The activator for an item: its action's, its override, or the default. */
export function activatorFor(item: NavItem<NavItemId>): NavActivator {
  if (item.target.type === 'action') return ACTION_ACTIVATORS[item.target.action]
  return DESTINATION_ACTIVATORS[item.id] ?? openDestination
}

/** Whether an item may be chosen now. Only Help and Brahma ever say no. */
export function navAvailability(
  id: NavItemId,
  deps: Pick<NavActivatorContext, 'helpChat' | 'brahmaConsole'>,
): NavAvailability {
  if (id === 'help' && deps.helpChat && !deps.helpChat.isEligible && !deps.helpChat.eligibilityLoading) {
    return { disabled: true, reason: 'Needs a help-enabled character with a tool-capable connection' }
  }
  if (id === 'brahma' && deps.brahmaConsole && !deps.brahmaConsole.isEligible) {
    return { disabled: true, reason: 'Needs a connection profile' }
  }
  return { disabled: false }
}
