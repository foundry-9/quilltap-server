/**
 * Shared types for the Lexical-based chat composer.
 *
 * @module components/chat/lexical/types
 */

/**
 * Imperative handle exposed by the Lexical composer wrapper.
 *
 * Replaces the previous HTMLTextAreaElement ref, providing the same
 * essential operations (focus, scrollIntoView) plus markdown-specific
 * methods for the bridge between Lexical's rich state and the
 * plain-string message pipeline.
 */
export interface ComposerEditorHandle {
  /** Focus the editor */
  focus(options?: FocusOptions): void
  /** Scroll the editor container into view */
  scrollIntoView(options?: ScrollIntoViewOptions): void
  /** Synchronously read the current editor content as a markdown string */
  getMarkdown(): string
  /** Replace the editor content with the given markdown string */
  setMarkdown(text: string): void
  /** Prepend text at the top of the editor (e.g. outfit notifications) */
  prependText(text: string): void
  /** Get the underlying Lexical editor instance (for FormattingToolbar) */
  getEditor(): import('lexical').LexicalEditor | null
}
