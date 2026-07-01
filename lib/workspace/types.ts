/**
 * Tabbed workspace — shared types.
 *
 * The workspace is a two-pane (left/right) tab host that renders every open
 * tab's view kept-alive (hidden via CSS, never unmounted) so streaming Salon
 * conversations survive tab switches. See
 * `docs/developer/features/tabbed-workspace.md` and
 * `docs/developer/decisions/ADR-0001-tabbed-workspace-routing.md`.
 *
 * @module lib/workspace/types
 */

export type PaneId = 'left' | 'right'

/**
 * The kind of surface a tab renders. `help` is intentionally absent — Help
 * stays a floating modal. `terminal` and `document` are child tabs of a Salon
 * tab (linked via `parentTabId`). `wardrobe` is a tab only when opened from the
 * left rail (the chat-scoped path keeps its dialog).
 */
export type TabKind =
  | 'home'
  | 'salon' // payload: { chatId: string }
  | 'terminal' // payload: { chatId: string; sessionId?: string } — child of a salon tab (Ariel)
  | 'document' // payload: { chatId: string; chatDocumentId: string } — child of a salon tab (Librarian)
  | 'aurora'
  | 'prospero'
  | 'scriptorium'
  | 'settings' // payload: { tab?: string; section?: string } (deep-link target)
  | 'files'
  | 'photos'
  | 'scenarios'
  | 'brahma'
  | 'wardrobe' // payload: { characterId?: string } — RAIL-opened only; NO chatId
  | 'profile' // the user's profile page
  | 'about' // the About page
  | 'generate-image' // standalone (chat-less) image generation
  | 'character-new' // the create-a-character form
  | 'character-edit' // payload: { characterId: string; tab?: string }
  | 'character-view' // payload: { characterId: string; tab?: string } — the read-only character detail page
  | 'settings-wizard' // the provider setup wizard, re-entered from Settings

/** Kind-specific tab payloads. */
export interface SalonTabPayload {
  chatId: string
}
export interface TerminalTabPayload {
  chatId: string
  sessionId?: string
}
export interface DocumentTabPayload {
  chatId: string
  /** Row id of the open chat_documents record this tab edits. Several document
   * tabs may share a chatId — one per open document. */
  chatDocumentId: string
  /** Cached title for the tab label (the document's display title). */
  displayTitle?: string
}
export interface SettingsTabPayload {
  tab?: string
  section?: string
}
export interface WardrobeTabPayload {
  characterId?: string
}
export interface CharacterEditTabPayload {
  characterId: string
  /** Deep-link target sub-tab (e.g. `system-prompts`). */
  tab?: string
}
export interface CharacterViewTabPayload {
  characterId: string
  /** Deep-link target sub-tab (e.g. `conversations`). */
  tab?: string
}

export interface WorkspaceTab {
  /** Stable uuid. */
  id: string
  kind: TabKind
  /** Kind-specific payload (e.g. `{ chatId }`). */
  payload?: unknown
  /** Shown on the tab. */
  title: string
  icon?: string
  /** For terminal/document: the salon tab they belong to. */
  parentTabId?: string
}

export interface PaneState {
  /** Tab ids in display order. */
  order: string[]
  /** The visible tab in this pane. */
  activeTabId: string | null
}

export interface WorkspaceState {
  tabs: Record<string, WorkspaceTab>
  panes: {
    left: PaneState
    /** `null` = unsplit (single full-width pane). */
    right: PaneState | null
  }
  /** Last-interacted pane; new rail-opened tabs land here. Default `'left'`. */
  focusedPane: PaneId
  /** Left pane fraction of width when split (0..1). Persisted. */
  splitRatio: number
}

/** Default split ratio (panes evenly split). */
export const DEFAULT_SPLIT_RATIO = 0.5

/**
 * Min/max left-pane fraction so neither pane becomes unusably narrow. Mirrors
 * the spirit of the Chat Sidebar's `MIN_CHAT_WIDTH` guard, expressed as a
 * fraction so it is viewport-independent in the reducer (pixel clamping happens
 * in the divider drag handler).
 */
export const MIN_SPLIT_RATIO = 0.2
export const MAX_SPLIT_RATIO = 0.8
