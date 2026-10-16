# Bug 251 — Enter on a code block's blank trailing line sends the message instead of leaving the block

| | |
|---|---|
| **Status** | FIXED |
| **Found** | 2026-10-15, live on `V4test` during the Lexical 0.52 upgrade smoke test |
| **Fixed** | 2026-10-16 |
| **Severity** | Low–Medium. In chat mode the message is sent half-written, with the code block still open; in composition mode Enter adds another line inside the block instead of leaving it. Nothing is lost, but you cannot leave a code block from the keyboard |
| **Who it bites** | anyone typing a fenced code block in the Salon composer, in either mode |
| **Provenance** | Original to v4. Behaves the same on Lexical 0.43 and 0.52 (checked headless against both); not caused by the upgrade |
| **Fix site** | `components/chat/lexical/plugins/KeyboardPlugin.tsx` (`$codeBlockToEscape`) |
| **v5 status** | Not applicable (v5 does not use Lexical) |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-16).** The escape check now recognises both caret shapes at the end of a code
block, and the exit removes only the trailing blank line, leaving the earlier lines' nodes untouched.
Pinned by `__tests__/unit/components/chat/lexical/plugins/KeyboardPlugin.test.tsx`.

## Symptom

In the Salon composer, type ```` ``` ```` and a space (a code block opens), type `x`, press Shift+Enter
for a blank line, then press Enter. The documented behaviour is that Enter on a blank trailing line
leaves the block. Instead, in chat mode the message is sent; in composition mode another line is added
inside the block.

## Root cause

`KeyboardPlugin`'s `KEY_ENTER_COMMAND` handler (`COMMAND_PRIORITY_HIGH`) looked for the escape case by
taking `selection.anchor.getNode()`, requiring its parent to be a `CodeNode` and the node to be that
parent's last child, at its end. After Shift+Enter, though, Lexical leaves the caret as an **element**
point on the `CodeNode` itself, at an offset equal to its child count. `anchor.getNode()` then returns
the code node, whose parent is the root, so the check failed and the handler fell through to the
chat-mode "Enter sends" branch. The check matched only when the blank line held whitespace, because
then the caret sat in a text node.

## Why it survived

The plugin had no tests, and the only behaviour tests nearby use a mock editor. The escape path only
looked right when read against the text-point case.

## The fix

`$codeBlockToEscape(selection)` returns the code block to leave, or null. It accepts a collapsed caret
that is either an element point on a `CodeNode` at `offset === getChildrenSize()`, or a text point at
the end of the code node's last child, and requires the block's last line to be blank and at least two
lines long. The handler calls it once in a read, to decide, and again inside the update. The update
removes whitespace-only text after the last line break, then the line break, and puts the caret in a
new paragraph after the block. The old code cleared the block and rebuilt it as a single highlight
node.

## How to verify

`npx jest __tests__/unit/components/chat/lexical/plugins/KeyboardPlugin.test.tsx`: both modes, a
whitespace-only blank line, a multi-line block, and the cases that must not escape (last line has
content; caret not at the end). Live on `V4test`: the sequence above leaves `x` in the block and the
caret in a paragraph below it, and no message is sent.
