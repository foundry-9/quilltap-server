/**
 * Lexical editor theme mapping.
 *
 * Maps Lexical node types to CSS classes. Uses the existing qt-* semantic
 * classes where possible so that themes can override editor styling.
 *
 * @module components/chat/lexical/theme
 */

import type { EditorThemeClasses } from 'lexical'

export const composerTheme: EditorThemeClasses = {
  // Root element — styled via parent container, not here
  root: 'qt-lexical-root',
  // Text formatting
  text: {
    bold: 'qt-lexical-bold',
    italic: 'qt-lexical-italic',
    underline: 'qt-lexical-underline',
    strikethrough: 'qt-lexical-strikethrough',
    code: 'qt-lexical-code',
  },
  // Block-level nodes
  paragraph: 'qt-lexical-paragraph',
  heading: {
    h1: 'qt-lexical-h1',
    h2: 'qt-lexical-h2',
    h3: 'qt-lexical-h3',
    h4: 'qt-lexical-h4',
    h5: 'qt-lexical-h5',
    h6: 'qt-lexical-h6',
  },
  list: {
    ul: 'qt-lexical-ul',
    ol: 'qt-lexical-ol',
    listitem: 'qt-lexical-li',
    listitemChecked: 'qt-lexical-li-checked',
    listitemUnchecked: 'qt-lexical-li-unchecked',
    nested: {
      listitem: 'qt-lexical-li-nested',
    },
    checklist: 'qt-lexical-checklist',
  },
  quote: 'qt-lexical-blockquote',
  link: 'qt-lexical-link',
  code: 'qt-lexical-code-block',
  codeHighlight: {
    atrule: 'qt-lexical-tokenAttr',
    attr: 'qt-lexical-tokenAttr',
    boolean: 'qt-lexical-tokenProperty',
    builtin: 'qt-lexical-tokenSelector',
    cdata: 'qt-lexical-tokenComment',
    char: 'qt-lexical-tokenSelector',
    class: 'qt-lexical-tokenFunction',
    'class-name': 'qt-lexical-tokenFunction',
    comment: 'qt-lexical-tokenComment',
    constant: 'qt-lexical-tokenProperty',
    deleted: 'qt-lexical-tokenProperty',
    doctype: 'qt-lexical-tokenComment',
    entity: 'qt-lexical-tokenOperator',
    function: 'qt-lexical-tokenFunction',
    important: 'qt-lexical-tokenVariable',
    inserted: 'qt-lexical-tokenSelector',
    keyword: 'qt-lexical-tokenAttr',
    namespace: 'qt-lexical-tokenVariable',
    number: 'qt-lexical-tokenProperty',
    operator: 'qt-lexical-tokenOperator',
    prolog: 'qt-lexical-tokenComment',
    property: 'qt-lexical-tokenProperty',
    punctuation: 'qt-lexical-tokenPunctuation',
    regex: 'qt-lexical-tokenVariable',
    selector: 'qt-lexical-tokenSelector',
    string: 'qt-lexical-tokenSelector',
    symbol: 'qt-lexical-tokenProperty',
    tag: 'qt-lexical-tokenProperty',
    url: 'qt-lexical-tokenOperator',
    variable: 'qt-lexical-tokenVariable',
  },
}
