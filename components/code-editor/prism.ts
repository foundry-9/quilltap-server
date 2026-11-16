/**
 * The code editor's one door to Prism: manual mode first, then Lexical's
 * Prism highlighter, then the JSON grammar it does not bundle (CSS it does).
 * Import order is the point of this file.
 *
 * @module components/code-editor/prism
 */

import './prism-manual'
import { registerCodeHighlighting, PrismTokenizer, type Tokenizer } from '@lexical/code-prism'
import 'prismjs/components/prism-json'

export { registerCodeHighlighting, PrismTokenizer, type Tokenizer }
