# Bug 127 — the progressions card prints raw `</code>, <code>` at the reader when two entries are unreadable

| | |
|---|---|
| **Status** | Fixed in v4 (2026-09-09). Filed from the v5 port (P4.D170, the SPA half of character progressions), where the line was being transcribed and the join did not survive reading |
| **Found** | 2026-09-08 |
| **Fixed** | 2026-09-09 |
| **Severity** | Low (cosmetic, and only on a fault path) — but it is the sentence that tells someone their vault is damaged, so it is read at exactly the moment they are least able to shrug it off |
| **Who it bites** | any character whose `metadata.json` carries **two or more** unparseable `progressions` entries. One bad entry renders perfectly; the defect is invisible until the second |
| **Provenance** | Found by inspection while transcribing the component for the port, then **measured** against this repo's own React 19.2.8 with `react-dom/server` — not inferred from reading the JSX |
| **Defect site** | `components/characters/progressions/ProgressionsSection.tsx:132` — `<code>{invalidIds.join('</code>, <code>')}</code>` |
| **Fix site** | `components/characters/progressions/ProgressionsSection.tsx` — the ids render as elements via the map-with-separator shape `CustomToolRunDialog` already uses; two pins in `__tests__/unit/components/characters/progressions.test.tsx` |
| **v5 status** | **Convergence owed.** v4 has now adopted v5's shape, so the divergence below is retired — the two render identically for every id count. Kept here because ⚠ **no oracle compares this line**, so nothing on the v5 side tripped when v4 converged; the row is the manual record. *(Prior text: **Deliberate divergence, recorded.*** v5 renders the ids as separate `<code>` elements joined by `, ` — byte-identical output for one id, correct markup for several. Pinned by two specs in `apps/web/src/app/progressions/progressions-section.spec.ts`; the component's own comment and the `m6-screen-parity.md` row both name it. ⚠ **No oracle compares this line** (it is browser-only markup, and the SPA's differentials are the schema corpora), so nothing on the v5 side trips when v4 converges — the retirement is manual, off this row, in whichever drift catch-up absorbs the fix.)* |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-09-09).** The ids are rendered as elements rather than as
markup inside a string. `invalidIds.map((id, i) => <span key={id}>{i > 0 && ', '}<code>{id}</code></span>)`
is the same map-with-separator shape `CustomToolRunDialog` already uses for its
write-target and progression lists, so this is the house pattern rather than a
new one — and the surrounding paragraph, singular/plural triple included, did
not move.

Both cases are pinned in
`__tests__/unit/components/characters/progressions.test.tsx`. The two-id case
asserts the rendered text contains no `</code>` and that the DOM carries a
`<code>` element per id; the one-id case asserts the sentence reads
`being skipped: broken. Editing the file` exactly, which is what makes this a
fix rather than a copy change. Reverting the component leaves the two-id pin
red and the one-id pin green — the asymmetry the bug is about.

## Symptom

A character carrying two unreadable progression entries reads this on the
Aurora System Prompts tab:

> 2 entries in this character's `metadata.json` could not be read and are being
> skipped: `broken</code>, <code>other`. Editing the file directly is the way to
> mend them.

The ids are still legible, so it is not a data-loss bug — but the line hands a
user raw HTML at the moment it is telling them their vault is damaged, which
reads like a second, worse fault.

## Root cause

`ProgressionsSection.tsx:132` builds the id list by joining the ids with a
literal closing-and-reopening tag pair *inside a JSX expression*:

```tsx
being skipped: <code>{invalidIds.join('</code>, <code>')}</code>. Editing the file
```

The `join` produces a **string**, and React renders a string as a text node,
escaping it. The intent — one `<code>` per id — needs elements, not markup in a
string; the same shape would work in a template literal fed to
`dangerouslySetInnerHTML`, and nowhere else.

Measured against this repo's React 19.2.8 (`renderToStaticMarkup`, the JSX
rebuilt with `createElement` so no transpiler is in the loop):

| ids | rendered |
|---|---|
| `['broken']` | `<code>broken</code>` — correct |
| `['broken','other']` | `<code>broken&lt;/code&gt;, &lt;code&gt;other</code>` |
| `['a','b','c']` | `<code>a&lt;/code&gt;, &lt;code&gt;b&lt;/code&gt;, &lt;code&gt;c</code>` |

## Why it survived

Three things line up:

1. **One id renders perfectly.** The join has nothing to join, so the string is
   just the id and the surrounding `<code>` tags are real JSX. That is the
   overwhelmingly common case — a hand edit usually breaks one entry.
2. **The suite only ever passes one.** `__tests__/unit/components/characters/
   progressions.test.tsx`'s "says so when an entry in the vault could not be
   read" seeds a single bad entry and asserts `/could not be read/` — it never
   looks at the ids, and never supplies a second.
3. **It is a fault path.** Reaching it at all requires a `metadata.json` the
   schema refuses, which nothing in normal use produces: the editor validates
   before it writes, and Pascal's applier rolls back a refused entry.

## The fix

Render the ids as elements rather than as markup inside a string — map, not
join:

```tsx
being skipped:{' '}
{invalidIds.map((id, i) => (
  <span key={id}>
    {i > 0 && ', '}
    <code>{id}</code>
  </span>
))}
. Editing the file directly is the way to mend {invalidIds.length === 1 ? 'it' : 'them'}.
```

The same shape `CustomToolRunDialog.tsx` already uses for its write-target and
progression lists, so this is the house pattern rather than a new one. Nothing
else in the paragraph moves; the singular/plural triple is untouched.

## Verification

Two cases, one of which the suite already has the fixture shape for:

- **One id** — the rendered text is unchanged, character for character. That is
  what keeps this a safe fix rather than a copy change.
- **Two ids** — the rendered text contains no `</code>` and the DOM carries two
  `<code>` elements with the ids as their whole text content.

The second assertion is the one that matters, and `not.toContain('</code>')` is
the cheapest form of it: the escaped output is exactly a string containing that
literal.
