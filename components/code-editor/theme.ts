/**
 * The code editor's Lexical theme: the class each node and each Prism token
 * type is drawn with. The colours are the `--qt-code-token-*` tokens
 * (lib/themes/registry/groups/code-block.ts), applied by the matching
 * `qt-code-token-*` classes in app/styles/qt-components/_content.css.
 *
 * Prism's token types are many; they fold into eight colours.
 *
 * @module components/code-editor/theme
 */

import type { EditorThemeClasses } from 'lexical'

const COMMENT = 'qt-code-token-comment'
const KEYWORD = 'qt-code-token-keyword'
const STRING = 'qt-code-token-string'
const NUMBER = 'qt-code-token-number'
const PROPERTY = 'qt-code-token-property'
const SELECTOR = 'qt-code-token-selector'
const FUNCTION = 'qt-code-token-function'
const PUNCTUATION = 'qt-code-token-punctuation'

/** Prism token type → class. A type not listed is drawn in the plain code colour. */
export const CODE_TOKEN_CLASSES: Readonly<Record<string, string>> = {
  comment: COMMENT,
  prolog: COMMENT,
  doctype: COMMENT,
  cdata: COMMENT,
  atrule: KEYWORD,
  rule: KEYWORD,
  keyword: KEYWORD,
  important: KEYWORD,
  boolean: KEYWORD,
  null: KEYWORD,
  constant: KEYWORD,
  string: STRING,
  url: STRING,
  char: STRING,
  regex: STRING,
  'attr-value': STRING,
  number: NUMBER,
  hexcode: NUMBER,
  unit: NUMBER,
  property: PROPERTY,
  variable: PROPERTY,
  'attr-name': PROPERTY,
  selector: SELECTOR,
  tag: SELECTOR,
  function: FUNCTION,
  builtin: FUNCTION,
  punctuation: PUNCTUATION,
  operator: PUNCTUATION,
}

export const codeEditorTheme: EditorThemeClasses = {
  code: 'qt-code-editor-code',
  codeHighlight: CODE_TOKEN_CLASSES as Record<string, string>,
  paragraph: 'qt-code-editor-code',
}
