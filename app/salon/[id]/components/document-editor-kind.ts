/**
 * Which editor Document Mode opens a file in (Calliope Live, Spec G,
 * Stage 3).
 *
 * Markdown goes to the rich Lexical editor. JSON and CSS go to the code
 * editor (`components/code-editor/`), which highlights them and hands back
 * exactly the bytes it was given. Everything else — and a JSON or CSS file
 * too large to highlight comfortably — stays in the plain `<textarea>`, whose
 * bytes go straight to and from disk.
 *
 * @module app/salon/[id]/components/document-editor-kind
 */

export type DocumentEditorKind = 'markdown' | 'json' | 'css' | 'plain'

/**
 * Above this many characters a JSON or CSS file opens in the textarea. The
 * code editor stays quick to type in at a realistic 2,000-line file (about
 * 16 ms a key, Stage 0) but slows with size; 100,000 characters is well past
 * every bundled theme file and every theme draft's.
 */
export const CODE_EDITOR_MAX_CHARS = 100_000

function extensionOf(filePath: string): string {
  const slash = filePath.lastIndexOf('/')
  const dot = filePath.lastIndexOf('.')
  return dot > slash ? filePath.slice(dot).toLowerCase() : ''
}

/** The editor for a file at `filePath` whose content, when it was loaded, was `length` characters long. */
export function documentEditorKind(filePath: string, length: number): DocumentEditorKind {
  const ext = extensionOf(filePath)
  if (ext === '.md' || ext === '.markdown') return 'markdown'
  if ((ext === '.json' || ext === '.css') && length <= CODE_EDITOR_MAX_CHARS) return ext === '.json' ? 'json' : 'css'
  return 'plain'
}

/** What the status bar calls a file of this kind, by its extension (a large JSON file is still JSON). */
export function documentTypeLabel(filePath: string): string {
  const ext = extensionOf(filePath)
  if (ext === '.md' || ext === '.markdown') return 'Markdown'
  if (ext === '.json') return 'JSON'
  if (ext === '.css') return 'CSS'
  return 'Plain text'
}

/**
 * The 1-based line a `doc_focus` anchor or highlight falls on: the first line
 * holding the text, matched exactly, then ignoring case. Null when it is not
 * there.
 */
export function lineOfText(content: string, text: string | undefined): number | null {
  const needle = text?.trim()
  if (!needle) return null
  let at = content.indexOf(needle)
  if (at < 0) at = content.toLowerCase().indexOf(needle.toLowerCase())
  if (at < 0) return null
  let line = 1
  for (let i = content.indexOf('\n'); i !== -1 && i < at; i = content.indexOf('\n', i + 1)) line++
  return line
}
