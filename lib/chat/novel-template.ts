/**
 * The built-in "Novel" roleplay template.
 *
 * Prose as a published novel prints it: narration is plain, unmarked text (set
 * in italics), dialogue sits in straight or curly double quotes, a single `*`
 * marks emphasis (bold + italic), `**` means nothing, and ((double parentheses))
 * are out of character.
 *
 * Novel deliberately uses nothing but the capabilities the template editor
 * offers — unmarked narration, an unmarked-text style, Markdown asterisks off,
 * curly-tolerant and open-ended wrap delimiters — and its rendering patterns are
 * derived by the same generator a user-built template's are, so anyone could
 * rebuild it by hand. Seeded by `roleplay-templates.repository.ts`.
 *
 * @module lib/chat/novel-template
 */

import type { RoleplayTemplate, TemplateDelimiter, UnmarkedStyle } from '@/lib/schemas/template.types'
import { generateTemplateRenderingPatterns } from '@/lib/chat/annotations'

/**
 * Novel's formatting marks. Dialogue accepts straight or curly quotes in any mix
 * and may run unclosed to the end of a paragraph (speech carried over several
 * paragraphs). Emphasis is a single asterisk, concealed, bold + italic — it
 * claims `*` because Novel takes asterisks away from Markdown.
 */
export const NOVEL_DELIMITERS: TemplateDelimiter[] = [
  {
    kind: 'wrap',
    name: 'Dialogue',
    buttonName: 'Dia',
    delimiters: '"',
    style: 'qt-chat-dialogue',
    matchCurlyQuotes: true,
    closeOptional: true,
  },
  {
    kind: 'wrap',
    name: 'Emphasis',
    buttonName: 'Emph',
    delimiters: '*',
    style: 'qt-roleplay-plain',
    hideDelimiter: true,
    addOns: { bold: true, italic: true, reverse: false, underline: 'none', border: 'none', font: '' },
  },
  { kind: 'wrap', name: 'Out of Character', buttonName: 'OOC', delimiters: ['((', '))'], style: 'qt-chat-ooc' },
]

/** Novel's narration: whatever no mark claims, set in italics. */
export const NOVEL_UNMARKED_STYLE: UnmarkedStyle = {
  style: 'qt-roleplay-plain',
  addOns: { bold: false, italic: true, reverse: false, underline: 'none', border: 'none', font: '' },
}

/**
 * Novel's instructions to the model. Plain and literal (it is read by an LLM),
 * and it ends on a worked example because models copy the shape of an example
 * far more faithfully than they follow a list of rules.
 */
export const NOVEL_SYSTEM_PROMPT = `[SYSTEM INSTRUCTION: NOVEL FORMATTING]
Write every reply the way a published novel is typeset. This replaces any roleplay formatting habits you may have.

1. NARRATION IS PLAIN PROSE. Action, description, setting and inner life are ordinary sentences with no marks around them. Never wrap actions or narration in asterisks, brackets or any other symbol.
   - Right: She set the cup down without drinking from it.
   - Wrong: *She sets the cup down.*

2. DIALOGUE GOES IN DOUBLE QUOTATION MARKS. Straight ("...") or curly (\u201c...\u201d) are both fine. Attribute speech with ordinary dialogue tags and action beats, as fiction does.
   - Example: "You're late," he said, not looking up from the ledger.
   - When one speaker talks across several paragraphs, leave the closing quotation mark off every paragraph except the last, and open each new paragraph with a quotation mark.
   - Use single quotation marks only for a quotation inside dialogue.

3. EMPHASIS USES SINGLE ASTERISKS. Put one asterisk on each side of a stressed word or short phrase, in narration or in dialogue, and use it as sparingly as print uses italics: vocal stress, a ship's name, a foreign word.
   - Example: "I said I would *try*."
   - Never use double asterisks (**like this**). They mean nothing here and will not display as bold. For shouting, let the prose carry it ("she bellowed") or, rarely, use capitals.

4. THOUGHTS BELONG TO THE NARRATION. Report them as a novelist would ("He wondered whether she had seen the letter") or in free indirect style. Do not set off whole thoughts with symbols; emphasize a single word with asterisks if it must be stressed.

5. OUT OF CHARACTER TALK USES DOUBLE PARENTHESES. Text ((like this)) is someone speaking outside the story. Answer it briefly, also in double parentheses, then carry on with the scene unless asked not to. Make your own out-of-character remarks the same way, and only when necessary. Never put story content inside double parentheses.

6. NO OTHER MARKUP. No headings, bulleted or numbered lists, tables, bold or code formatting in the story. Paragraph breaks do the work. To mark a scene break, put * * * alone on its own line.

7. STAY CONSISTENT. Keep the person and tense the story is already using. Hold this format for the whole conversation, even if earlier messages used a different one.

EXAMPLE OF A CORRECTLY FORMATTED REPLY:

The rain had followed her all the way from the station, and by the time Marguerite reached the top of the stairs her hem was black with it. She paused at the door, listening. Somewhere inside, a gramophone was playing something slow.

"You came," Theo said when she let herself in. He did not get up. "I wasn't sure you would."

"Neither was I." She hung her coat on its old hook as though she had never stopped doing it. "Your note said it was *urgent*."

He turned the envelope over in his hands, and she saw that the seal was already broken. So he had read it. Of course he had.`

/** The Novel template as seeded (built-in, read-only). */
export const NOVEL_TEMPLATE: Omit<RoleplayTemplate, 'id' | 'createdAt' | 'updatedAt'> = {
  userId: null,
  name: 'Novel',
  description:
    'Prose as a novel prints it: plain narration, "dialogue" in quotes, *emphasis* in single asterisks, and ((out of character)) in double parentheses.',
  systemPrompt: NOVEL_SYSTEM_PROMPT,
  isBuiltIn: true,
  tags: [],
  delimiters: NOVEL_DELIMITERS,
  renderingPatterns: generateTemplateRenderingPatterns({
    delimiters: NOVEL_DELIMITERS,
    narrationDelimiters: null,
    unmarkedStyle: NOVEL_UNMARKED_STYLE,
    markdownAsterisks: false,
  }),
  dialogueDetection: {
    openingChars: ['"', '\u201c'],
    closingChars: ['"', '\u201d'],
    className: 'qt-chat-dialogue',
  },
  // Narration is unmarked prose, styled by unmarkedStyle
  narrationDelimiters: null,
  unmarkedStyle: NOVEL_UNMARKED_STYLE,
  markdownAsterisks: false,
}
