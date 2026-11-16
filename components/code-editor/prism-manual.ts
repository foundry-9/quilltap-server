/**
 * Must be imported before anything that loads `prismjs`.
 *
 * Prism, when it loads in a browser, highlights every
 * `code[class*="language-"]` on the page on the next frame unless it finds
 * `window.Prism.manual` already set. The Salon's Markdown code blocks carry
 * exactly those classes, and React owns their DOM, so the code editor loads
 * Prism in manual mode: it highlights only what Lexical hands it.
 *
 * @module components/code-editor/prism-manual
 */

type PrismFlags = { manual?: boolean; disableWorkerMessageHandler?: boolean }

const scope = globalThis as unknown as { Prism?: PrismFlags }
if (!scope.Prism) {
  scope.Prism = { manual: true, disableWorkerMessageHandler: true }
} else {
  scope.Prism.manual = true
}

export {}
