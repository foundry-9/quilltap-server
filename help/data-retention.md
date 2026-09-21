---
url: /settings?tab=chat&section=data-retention
---

# Data Retention — The Nightly Tidying of Quiet Rooms

> **[Open this setting in Quilltap](/settings?tab=chat&section=data-retention)**

Every conversation you keep, Quilltap keeps in full — every word, forever, or until you say otherwise. But a conversation also gathers a certain amount of behind-the-scenes paraphernalia as it goes: compression caches, pre-rendered pages, the models' own scratch-work and thinking traces, and the mathematical fingerprints (embeddings) that let semantic search find things by meaning rather than by exact words. In a busy establishment, the quiet rooms end up storing rather a lot of this — none of it part of the story, all of it faithfully rebuilt on demand.

The **Data Retention** setting tells the nightly housekeeping how long a chat must sit idle before its working data is tidied away.

## What "idle" means

A chat is considered idle when nobody has *actually spoken* in it for the configured number of days — you, or one of your characters. Announcements from the Staff (the Lantern's image notes, the Host's room business, Prospero's tool reports, and their colleagues) do not count as activity; a room isn't "in use" merely because the servants have been dusting it.

## What gets tidied — and what never is

Once a chat crosses the threshold, the nightly sweep clears:

- **Regenerable caches** — compression caches, pre-rendered text, and the precompiled introductions Quilltap assembles for each character in the room, all rebuilt automatically the next time they're wanted.
- **Model scratch-work** — raw provider payloads, thinking/reasoning traces, and memory-extraction debug logs from old messages. These are diagnostic ephemera; the messages themselves are untouched.
- **Superseded generated images** — old story backgrounds and outfit avatars the chat no longer references (the current ones always stay; so does anything you saved to a gallery or promoted to a character).
- **Conversation embeddings** — the semantic-search fingerprints of the chat's interchanges. The rendered text of each interchange is kept, so keyword search still works.

Never touched, at any age: the messages themselves, attachments, memories, conversation summaries, and anything you deliberately saved.

## Search while a chat is cold

A tidied ("cold") chat remains fully readable, and **keyword search** over it works exactly as before. **Semantic search** — the kind that finds a conversation by meaning, through the Scriptorium or conversation-summary retrieval — will not surface a cold chat until it has been re-indexed. That happens automatically the moment you reopen the chat (Quilltap quietly queues the re-embedding in the background), or you can force the matter for any conversation by clicking its **Scriptorium status badge** on the chat's card in the Salon list, which re-renders and re-embeds the whole affair.

Once rewarmed, the index *stays* warm for a full retention window from your visit: the housekeeping recognizes a freshly re-laid fire and declines to rake it out the same evening, even if nobody has spoken in the room. Merely reading an old conversation therefore keeps it findable by meaning for another N days — no re-embedding bill each time you stop by to reminisce.

## Configuring the window

1. Open **Settings → Chat Settings → Data Retention**
2. Set **"Keep inactive chats' working data for N days"** (1–3650; the default is 30)
3. The setting applies to the entire establishment — there is deliberately no per-chat dial

A longer window means less tidying and a larger database; a shorter one keeps the cellars lean at the cost of the occasional background re-index when you revisit an old haunt.

## Reclaiming the space

The sweep frees space *inside* the database file; the file itself shrinks only when compacted. When you'd like the bytes back on disk, stop the server and run:

```
npx quilltap db optimize
```

which performs a VACUUM and re-tunes the query planner while it's at it.

## The cellars are packed more tightly now

Quite apart from the nightly tidying, Quilltap has taken to storing three sorts of bulky item more
economically. None of this is a setting, none of it discards anything, and none of it changes what
you can read, search, or export — it is simply better packing, and it happens whether you attend to
it or not.

- **Pictures in your document stores** are now re-encoded to a sensible size the moment they are
  filed. Previously a few routes admitted images at their full unreduced bulk — a portrait arriving
  as a six-megabyte plate when a tenth of that would hang just as well. The dimensions are
  untouched; only the needless weight goes. Anything you import from a `.qtap` bundle, or wake from
  an archive, is restored exactly as it was packed away.
- **The correspondence with the models** — the verbatim record of every prompt sent and reply
  received, which the LLM log viewer shows you — is folded into a fraction of its former space. It
  reads back identically.
- **The rendered transcripts** the Scriptorium keeps for searching are compressed likewise. They
  were always a second copy of your conversation, rebuilt on demand; now they are a smaller one.

On an establishment of some two gigabytes, the three together returned roughly a quarter of the
cellar. Do run the compaction above afterwards, or the space is merely freed *within* the files
rather than returned to your disk.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this setting:

`help_navigate(url: "/settings?tab=chat&section=data-retention")`

## Related Settings

- [Chat Settings](chat-settings.md) — The rest of the chat-wide defaults
- [Memory Housekeeping](memory-housekeeping.md) — The Commonplace Book's own tidying
- [The Scriptorium](scriptorium.md) — Semantic search over documents and conversations
