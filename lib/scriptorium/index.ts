/**
 * Scriptorium Module
 *
 * Deterministic conversation rendering and annotation system for
 * Project Scriptorium. Converts chat messages into structured Markdown
 * with support for character annotations.
 *
 * @module scriptorium
 */

export { renderConversationMarkdown } from './markdown-renderer'
export { mergeAnnotations, stripAnnotations } from './annotation-merger'
