---
url: *
---

# Search Bar

> **[Open this page in Quilltap](/)**

The search bar is your powerful tool for finding anything across Quilltap quickly. Located at the top center of the page, it helps you discover chats, characters, messages, documents, tags, and memories in seconds.

## How to Search

### Getting Started

- **Click the search bar** to open it and start typing
- **Use the keyboard shortcut** — Press **Cmd+K** (Mac) or **Ctrl+K** (Windows/Linux) from anywhere in Quilltap to focus the search bar instantly
- **Type your query** — Start searching with 2 or more characters

### Search Types

The search bar searches across six categories:

1. **Chats** — Find conversations by title
2. **Characters** — Locate characters by name or description
3. **Messages** — Find what was actually said, inside any conversation. Searched through a proper index, so the answer arrives before your finger leaves the key
4. **Documents** — Find documents in any of your document stores, by name, by folder, or by what is written inside them
5. **Tags** — Search for content tagged with specific keywords
6. **Memories** — Find stored memories and notes from conversations

Each category has a chip in the full search dialog; switch one off and the search obligingly stops looking there.

### Opening a Document from Search

Click a document result and it opens in Document Mode — but *where* it opens depends on what you were doing at the time, which is rather the point:

- **If you have a conversation in front of you**, the document opens **in that conversation**, precisely as though you had summoned it from the composer's document picker. The Librarian announces the arrival, and your characters see every subsequent save. This is deliberate: a document opened at the table is a document everyone at the table can see.
- **If you have no conversation in front of you**, the document opens in **standalone Document Mode** — no conversation attached, no announcement made, and not a whisper to anybody about anything you write there.

Middle-click (or "open in new tab") always takes the discreet standalone route, whatever else is on your screen.

### Using Search Results

As you type, you'll see:

- **Result previews** — A dropdown showing matching items
- **Result counts** — How many results match in each category
- **Result categories** — Items grouped by type (chats, characters, messages, documents, tags, memories)
- **View all option** — Click "View all" under any category to see the complete list

Click any result to navigate directly to it.

## Mobile vs. Desktop

### Desktop Search

- **Inline dropdown** — Results appear in a dropdown as you type
- **Quick preview** — See results instantly without leaving the page
- **Fast navigation** — Click a result to jump to it immediately

### Mobile Search

- **Full-screen dialog** — On smaller screens, search opens in an expanded view
- **Better visibility** — More space to see and select results
- **Easier scrolling** — Swipe through results comfortably on your phone

On mobile, the search experience automatically adapts for better usability.

## Search Tips

1. **Use specific keywords** — Search for exact names or titles for best results
   - Example: "Alice" finds the character Alice quickly
   - Example: "Project A" finds chats or files related to Project A

2. **Search for tags** — If you tag your content, search for tags to find related items
   - Example: "romance" finds all tagged items related to romance

3. **Use memory searches** — Find specific conversations or details you've stored
   - Example: "character background" finds related memories

4. **Minimum 2 characters** — The search requires at least 2 characters to begin searching

5. **Navigate with keyboard** — On desktop:
   - Use **arrow keys** to navigate through results
   - Press **Enter** to select a result
   - Press **Escape** to close the search dropdown

## What Gets Indexed

The search indexes:

- **Chat titles and content** — Find conversations by name or message content; every line ever spoken sits in a catalogue built for the purpose
- **Character names and bios** — Locate characters by their profiles
- **Document names, paths, and text** — Every enabled document store is searched, character vaults included
- **Tags and keywords** — Search by labels you've applied to content
- **Memories** — Find stored facts, relationships, and notes about your characters

### What the Document Search Reaches

The Documents category searches the *text* of your documents — the words themselves, plus the file's name and the folders it sits in. A few sensible boundaries apply:

- **Only documents that can be opened and edited** are searched: Markdown, plain text, JSON and JSONL. A PDF, a Word file, a photograph, or any other parcel of bytes is not searched, so no result can lead you somewhere you cannot go.
- **A document whose text has not yet been extracted** is not searchable until it has been. Freshly added files may take a moment.
- **Archived characters' vaults are never searched.** An archived character is a closed chapter; its papers stay in the box.
- **Documents hidden from characters are still found by you.** A document marked `character_read: false` in its frontmatter is invisible to your characters, not to their employer.

### How the Message Search Reads Your Words

The Messages category consults a catalogue of every word in every
conversation — an arrangement of admirable speed, and one with its own
manners, which it is only civil to explain:

- **It matches whole words and the beginnings of words**, not any stray run of
  letters. Searching `walk` finds *walking* and *walked*; it does **not** find
  *sidewalk*. This is the one genuine trade for the speed, and in practice
  nobody misses it.
- **Accents are treated as decoration.** `café` finds *cafe*, and `cafe` finds
  *café*. Capital letters remain irrelevant, as they always were — and now in
  every alphabet, not merely the English one.
- **Punctuation is not catalogued**, but it no longer trips the thing up
  either. `Mr. Smith`, `Ms. Havisham (née Anybody)` and their punctuated
  brethren now find what they are looking for; previously they returned, with
  great confidence, nothing whatsoever.
- **A search made entirely of punctuation or single letters** — `C++`, say —
  steps off the catalogue and searches the transcripts letter by letter. It is
  slower. It is also exactly right, which on balance seems the better bargain.
- **Word order still counts.** Type two words and the search looks for them
  together, in that order, as you typed them.
- **Results arrive newest first**, capped at one hundred, as before — not
  ordered by how well they match.

Only what was actually *said* is catalogued: your messages and your
characters'. House announcements, system events and the Staff's own asides
remain unsearchable, precisely as they always have been.

## Search Limitations

- Search requires at least **2 characters** to start
- Search matches **words**, not meanings — it finds "manifesto", not "declaration of principles". (Your characters have semantic search; the search bar is a plain, honest, literal-minded instrument.)
- Results are limited to your **personal content** (you only see your own chats, characters, etc.)
- Some very large documents may take a moment to search
- Search is **case-insensitive** — "alice" finds "Alice"
- Message search finds **whole words and word beginnings**, not arbitrary fragments — see *How the Message Search Reads Your Words*, above

## Quick Access

The keyboard shortcut **Cmd+K** (Mac) or **Ctrl+K** (Windows/Linux) is the fastest way to search from anywhere in Quilltap. Use it frequently to speed up your workflow!

Need help with search results? Click the result to navigate to its full page where you can see all details.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/")`
