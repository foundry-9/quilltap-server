/**
 * Brace indentation (Calliope Live Spec I, decision 1): what Enter inserts
 * and when a typed closing brace steps out, in JSON and CSS, with tabs and
 * with spaces. Which braces are structure is read from the highlighter's own
 * tokens, so these run against real Prism.
 */

import { applyEdits, planCloseBracket, planEnter, type TokenTypeAt } from '@/components/code-editor/text'
import { tokenizeToPieces } from '@/components/code-editor/tokenizer'

type Language = 'json' | 'css'

/** Token types by offset, from the pieces the editor's nodes are made of. */
function typesOf(text: string, language: Language): TokenTypeAt {
  const types: (string | undefined)[] = []
  for (const piece of tokenizeToPieces(text, language)) {
    if (piece.kind === 'text') for (let i = 0; i < piece.text.length; i++) types.push(piece.type)
    else types.push(undefined)
  }
  return (offset) => types[offset]
}

/** `|` marks the caret; two of them mark a selection. */
function parse(marked: string) {
  const anchor = marked.indexOf('|')
  const rest = marked.slice(0, anchor) + marked.slice(anchor + 1)
  const second = rest.indexOf('|')
  if (second === -1) return { text: rest, anchor, focus: anchor }
  return { text: rest.slice(0, second) + rest.slice(second + 1), anchor, focus: second }
}

function show(text: string, caret: number): string {
  return text.slice(0, caret) + '|' + text.slice(caret)
}

function enter(marked: string, language: Language, unit: string): string {
  const { text, anchor, focus } = parse(marked)
  const plan = planEnter(text, anchor, focus, unit, typesOf(text, language))
  expect(plan.anchor).toBe(plan.focus)
  return show(applyEdits(text, plan.edits), plan.anchor)
}

function close(marked: string, bracket: string, language: Language, unit: string): string | null {
  const { text, anchor, focus } = parse(marked)
  const plan = planCloseBracket(text, anchor, focus, unit, bracket, typesOf(text, language))
  return plan ? show(applyEdits(text, plan.edits), plan.anchor) : null
}

describe('planEnter', () => {
  it('keeps the line’s indentation where no brace opens', () => {
    expect(enter('a {\n  color: red;|\n}\n', 'css', '  ')).toBe('a {\n  color: red;\n  |\n}\n')
    expect(enter('{\n\t"a": 1,|\n}\n', 'json', '\t')).toBe('{\n\t"a": 1,\n\t|\n}\n')
    expect(enter('|', 'css', '  ')).toBe('\n|')
  })

  it.each([
    ['css', '  ', 'a {|', 'a {\n  |'],
    ['css', '\t', 'a {|', 'a {\n\t|'],
    ['css', '    ', '@media (min-width: 1px) {\n    a {|\n}', '@media (min-width: 1px) {\n    a {\n        |\n}'],
    ['json', '  ', '{\n  "a": [|\n}', '{\n  "a": [\n    |\n}'],
    ['json', '\t', '{\n\t"a": {|\n}', '{\n\t"a": {\n\t\t|\n}'],
    // Spaces between the brace and the caret do not hide it.
    ['css', '  ', 'a {  |', 'a {  \n  |'],
  ] as const)('%s, unit %j: after an opening brace the new line is one unit deeper', (language, unit, before, after) => {
    expect(enter(before, language, unit)).toBe(after)
  })

  it.each([
    ['css', '  ', 'a {|}', 'a {\n  |\n}'],
    ['css', '\t', '\ta {|}\n', '\ta {\n\t\t|\n\t}\n'],
    ['json', '  ', '{\n  "a": {|}\n}', '{\n  "a": {\n    |\n  }\n}'],
    ['json', '\t', '{\n\t"a": [|]\n}', '{\n\t"a": [\n\t\t|\n\t]\n}'],
    ['json', '    ', '{|}', '{\n    |\n}'],
    // Spaces inside the pair go; nothing is left trailing before the closing brace.
    ['css', '  ', 'a { | }', 'a { \n  |\n}'],
  ] as const)('%s, unit %j: between a pair the closing brace gets its own line', (language, unit, before, after) => {
    expect(enter(before, language, unit)).toBe(after)
  })

  it.each([
    ['css', '  ', 'a {| color: red; }', 'a {\n  |color: red; }'],
    ['css', '\t', 'a {|color: red;\n}', 'a {\n\t|color: red;\n}'],
    ['json', '  ', '{|"a": 1}', '{\n  |"a": 1}'],
    ['json', '\t', '[| 1, 2]', '[\n\t|1, 2]'],
  ] as const)('%s, unit %j: text after the brace moves down, indented', (language, unit, before, after) => {
    expect(enter(before, language, unit)).toBe(after)
  })

  it('does not pair a brace with the other kind', () => {
    expect(enter('{\n  "a": [|}', 'json', '  ')).toBe('{\n  "a": [\n    |}')
  })

  it.each([
    ['json', '{\n  "a": "x{|"\n}', '{\n  "a": "x{\n  |"\n}'],
    ['json', '{\n  "a{|": 1\n}', '{\n  "a{\n  |": 1\n}'],
    ['json', '{\n  "a": "[|]"\n}', '{\n  "a": "[\n  |]"\n}'],
    ['css', 'a {\n  content: "{|";\n}', 'a {\n  content: "{\n  |";\n}'],
    ['css', 'a {\n  content: "{|}";\n}', 'a {\n  content: "{\n  |}";\n}'],
    ['css', '/* a {| */', '/* a {\n|'.concat(' */')],
    ['css', '  /* {|} */', '  /* {\n  |} */'],
    // A selector's own attribute brackets are not structure either.
    ['css', 'a[|href] {}', 'a[\n|href] {}'],
  ] as const)('%s: a brace in a string or a comment does not count (%j)', (language, before, after) => {
    expect(enter(before, language, '  ')).toBe(after)
  })

  it('replaces a selection first, then treats it as a caret', () => {
    expect(enter('a {|color: red;|}', 'css', '  ')).toBe('a {\n  |\n}')
    expect(enter('a {\n  color: |red|;\n}', 'css', '  ')).toBe('a {\n  color: \n  |;\n}')
    // Backwards too.
    const text = 'a {color: red;}'
    const plan = planEnter(text, 14, 3, '  ', typesOf(text, 'css'))
    expect(applyEdits(text, plan.edits)).toBe('a {\n  \n}')
    expect(plan.anchor).toBe(6)
  })
})

describe('planCloseBracket', () => {
  it.each([
    ['css', '  ', 'a {\n  color: red;\n  |', '}', 'a {\n  color: red;\n}|'],
    ['css', '\t', 'a {\n\tcolor: red;\n\t|\n', '}', 'a {\n\tcolor: red;\n}|\n'],
    ['css', '    ', '@media print {\n    a {\n        color: red;\n        |\n}', '}', '@media print {\n    a {\n        color: red;\n    }|\n}'],
    ['json', '  ', '{\n  "a": [\n    1\n    |\n}', ']', '{\n  "a": [\n    1\n  ]|\n}'],
    ['json', '\t', '{\n\t"a": {\n\t\t"b": 1\n\t\t|', '}', '{\n\t"a": {\n\t\t"b": 1\n\t}|'],
    ['json', '    ', '{\n    "a": 1\n    |', '}', '{\n    "a": 1\n}|'],
  ] as const)('%s, unit %j: a closing brace on an indented blank line steps out one unit', (language, unit, before, bracket, after) => {
    expect(close(before, bracket, language, unit)).toBe(after)
  })

  it('takes a tab off a tab-indented line whatever the unit, and at most the unit in spaces', () => {
    expect(close('a {\n\t|', '}', 'css', '  ')).toBe('a {\n}|')
    expect(close('a {\n   |', '}', 'css', '  ')).toBe('a {\n }|')
  })

  it('leaves the brace alone when the line holds anything but indentation', () => {
    expect(close('a {\n  color: red; |', '}', 'css', '  ')).toBeNull()
    expect(close('a {\n  |color: red;', '}', 'css', '  ')).toBeNull()
    expect(close('a {\n|', '}', 'css', '  ')).toBeNull()
    expect(close('{\n  "a": 1 |\n', '}', 'json', '  ')).toBeNull()
  })

  it('still steps out with only spaces after the caret', () => {
    expect(close('a {\n  |  \n', '}', 'css', '  ')).toBe('a {\n}|  \n')
  })

  it('leaves the brace where it belongs: a line no deeper than its opening brace’s', () => {
    expect(close('  a {\n    color: red;\n  |', '}', 'css', '  ')).toBeNull()
    expect(close('{\n\t"a": [\n\t\t1\n\t|', ']', 'json', '\t')).toBeNull()
    // Nothing open: nothing to step out of.
    expect(close('a {}\n  |', '}', 'css', '  ')).toBeNull()
  })

  it('does nothing inside a comment', () => {
    expect(close('a {\n  /* note\n    |\n  */\n}', '}', 'css', '  ')).toBeNull()
  })

  it('does not count braces in strings and comments when finding what is open', () => {
    expect(close('a {\n  content: "}";\n  /* } */\n  |', '}', 'css', '  ')).toBe('a {\n  content: "}";\n  /* } */\n}|')
    expect(close('{\n  "a": "}}",\n  |', '}', 'json', '  ')).toBe('{\n  "a": "}}",\n}|')
  })

  it('replaces a selection first', () => {
    expect(close('a {\n  |  color: red;|', '}', 'css', '  ')).toBe('a {\n}|')
  })
})
