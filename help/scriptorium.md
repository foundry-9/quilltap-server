---
url: /settings?tab=chat
---

# The Scriptorium

Imagine, if you will, a tireless scribe seated in the corner of every conversation you have — the sort of fellow who never spills the ink, never loses his place, and never once complains about the hours. The Scriptorium is precisely that: a system that renders your conversations into persistent, deterministic Markdown documents, complete with numbered messages, grouped interchanges, and the capacity for your characters to scribble annotations in the margins like so many well-read academics arguing over a first edition.

## How It Works

After each turn in a conversation, the Scriptorium automatically renders the entire exchange into a clean Markdown document. This is not a rough sketch on a cocktail napkin — it is a precise, reproducible rendering where every message receives a sequential number and every back-and-forth is gathered into tidy interchanges. Each rendered conversation is crowned with a metadata header — a brief dossier listing the conversation's title, creation date, participants, and vital statistics — ensuring that even the most casual reader can determine precisely what they are looking at before committing to the full text.

### Message Numbering

Messages are numbered sequentially starting from 0, because even scribes must bow to the conventions of computer science. Each message in the conversation receives exactly one number, assigned in the order it was spoken (or typed, or dramatically declaimed, depending on your style).

### Interchanges

Messages are grouped into **interchanges** — logical clusters that represent a turn of conversation. When you say something and a character responds, that exchange forms an interchange. In multi-character chats, an interchange encompasses the full chain of responses that follows a single prompt. Think of it as a scene in a play: the curtain rises, the dialogue unfolds, the curtain falls, and the Scriptorium dutifully records the whole affair before the next act begins.

### Searchable Chunks

Each interchange is embedded as a searchable chunk through the existing embedding pipeline. This means that the substance of your conversations becomes discoverable — one can search not merely for keywords but for the semantic meaning of what was discussed, like a librarian who actually read every book in the collection rather than just filing them by spine color.

### Editing Beside the Conversation

When Document Mode is open in the Salon, the Scriptorium also serves as your in-chat writing desk. For Markdown manuscripts you may work in rich text or flip over to raw source, and the formatting controls remain close at hand for either style of composition. Files that are not Markdown — JSON configurations, YAML recipes, plain text correspondence, and so forth — open in a monospaced textarea with no rich-text scaffolding whatsoever, which spares them the indignity of being quietly reformatted by a Markdown serializer. The split view remembers its layout for each chat, and the divider may be adjusted with the mouse or the keyboard — a small courtesy, perhaps, but a civilized one.

Should you wish to rechristen a document, click the title at the top of the editor pane, type the new name, and press Enter — the file itself is renamed in place, whether it lives on disk or inside a database-backed vault. Path separators and parent-directory escapes are politely refused, and if you omit the extension the previous one is tacked back on for you (so "backstory" becomes "backstory.md" if that is what the file was in the first place). A pending autosave is flushed before the rename, so no keystrokes are lost in the exchange. The Librarian then posts a brief note in the chat announcing the new name and path, so any characters present are apprised without your having to interrupt the scene.

Should a volume have outlived its usefulness, the header also offers a small trash-can button beside Close. A single click, a polite request for confirmation, and the underlying file is removed — whether it resides on disk or in a database-backed vault — the document pane is closed, and the Librarian announces the deletion in the chat so present characters know the volume is gone from the shelves. The action is irreversible; do reserve it for files you truly mean to dismiss.

When you are browsing a document store from the Open Document picker and find that no shelf yet exists for the volume you have in mind, the picker offers a discreet **New folder** entry just above the listing. Type the name, press Enter, and a fresh folder appears at your present location, ready to be entered and populated; press Escape to think better of it. The folder is created on the spot — in the database for database-backed stores, or on disk for filesystem mounts — so the next document you save into it lands precisely where you intend.

Opening, saving, renaming, or deleting a document in the chat no longer costs you your turn. The Librarian — that preternaturally discreet personified feature — steps in to announce the event on your behalf, noting the document's whereabouts (and, when a character is the one who reached for it via `doc_open_document`, `doc_delete_file`, `doc_create_folder`, or `doc_delete_folder`, attributing the act to the character in question). The announcements appear as attributed chat messages so everyone present is apprised of what has just happened at the desk, but the conversational floor remains yours to hold or yield as you see fit.

## The Tools

The Scriptorium provides three tools that characters can use during conversation. These are not tools you call directly — rather, your AI characters employ them as the situation demands, much like a well-trained butler who simply knows when to bring the tea.

### read_conversation

This tool allows a character to read the full rendered conversation document. It can be called with or without annotations included, giving the character a complete view of everything that has transpired — every message, every interchange, every dramatic revelation and quiet aside.

When supplied with a `conversationId` — perhaps one unearthed by the `search` tool — it can read any conversation in the archive, not merely the one currently in progress. Without a `conversationId`, it reads the present conversation, as one would naturally expect.

When annotations are included, the character sees not only the conversation itself but also any commentary that has been affixed to specific messages by any character in the chat.

### upsert_annotation

Characters can attach persistent annotations to specific messages, identified by message number. Each character may have exactly **one annotation per message** — calling this tool again on the same message replaces the previous annotation rather than stacking them up like an overenthusiastic reviewer's sticky notes.

Annotations appear as fenced code blocks within the rendered Markdown, clearly attributed to the character who wrote them. They serve as a character's private marginalia — observations, reactions, analytical notes, or the occasional sardonic aside that one simply cannot keep to oneself.

### delete_annotation

Should a character decide that a particular annotation has outlived its usefulness — perhaps the observation was premature, or the sardonic aside was a touch too sardonic — this tool removes it cleanly. The annotation vanishes as though it had never been, which is more than can be said for most regrettable remarks made at parties.

### search

This is the tool that transforms the Scriptorium from a mere record-keeping operation into something rather more resembling an actual research library. When invoked, it searches across both a character's personal memories *and* the full archive of rendered conversations simultaneously, returning a unified set of results ranked by relevance.

One may optionally restrict the search to particular sources — memories only, or conversations only — should one wish to narrow the field of inquiry. The results include sufficient metadata to identify the provenance of each finding: for memories, the importance and summary; for conversations, the title, interchange number, and participants. Armed with a conversation ID from the search results, a character can then call `read_conversation` to review the full text, completing the journey from vague recollection to precise citation.

## Why It Matters

The Scriptorium transforms ephemeral chat messages into structured, searchable documents. Characters can review what has been said with perfect fidelity, annotate the record with their own perspectives, and the entire corpus becomes discoverable through semantic search. It is, in short, the difference between a conversation that evaporates like morning fog and one that is preserved in the archives for future reference — indexed, annotated, and ready for consultation at a moment's notice.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=chat")`

## Related Topics

- [Chat Settings](chat-settings.md)
- [Using Tools in Chat](tools-usage.md)
- [Scene State Tracker](scene-state-tracker.md)
- [Embedding Profiles](embedding-profiles.md)
