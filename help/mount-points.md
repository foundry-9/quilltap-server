---
url: /scriptorium
---

# The Scriptorium

Consider, if you will, the predicament of the well-read conversationalist who possesses an impressive private library but cannot consult it during discussion. The document mount point system corrects this unfortunate oversight by allowing you to point Quilltap at directories full of documents — your notes, your research, your accumulated wisdom filed away in Markdown, PDF, Word, or plain text — and have their contents indexed, chunked, embedded, and made searchable alongside your memories and conversation history.

## How It Works

A mount point is simply a filesystem path — a directory on your machine (or perhaps an Obsidian vault, if you are the sort of person who maintains such things) that contains documents you wish your AI collaborators to be able to reference. When you create a mount point, Quilltap scans the directory, converts each supported document to plain text, divides that text into semantically coherent chunks, and generates embeddings for each chunk using your configured embedding profile.

### Supported Formats

- **Markdown** (`.md`) — Syntax is stripped; the text beneath remains
- **Plain text** (`.txt`) — Used as-is, because sometimes simplicity is its own reward
- **PDF** (`.pdf`) — Text is extracted; images and formatting are, regrettably, left behind
- **Word documents** (`.docx`) — The raw text is pulled from the elaborate XML machinery within

### Change Detection

Rather than watching your files with the anxious vigilance of a night porter, Quilltap takes the more measured approach of checking for changes on each startup. Every file receives a SHA-256 checksum, and on the next startup, only files whose checksums have changed are re-processed. New files are ingested, modified files are re-chunked, and files that have vanished from the directory have their chunks quietly removed — a tidy three-state reconciliation that requires no background watchers, no file system events, and no nervous energy whatsoever.

### Chunking

Documents are divided into chunks of approximately 800 to 1,200 tokens each, with a 200-token overlap between consecutive chunks to prevent important context from falling into the cracks between segments. The chunking algorithm respects paragraph boundaries where possible and tracks heading context, so each chunk knows what section of the document it belongs to.

## Managing Document Stores

Document stores are managed from the **Scriptorium** page, accessible via the database icon in the left sidebar. From there you can:

- **Add** a document store by providing a name and filesystem path
- **Edit** settings including name, path, mount type, include/exclude patterns, and enabled status
- **View** file counts, total size, chunk counts, and scan status at a glance on each store's card
- **Scan** a store to discover new, modified, or deleted files — click the Scan button on any store's card or detail page
- **Delete** a store, which removes all indexed data (the original files on disk are never touched)
- **Inspect** individual files by clicking through to a store's detail page, where you can see each file's type, size, conversion status, embedding chunk count, and last-modified date

You may also manage document stores through the API at `/api/v1/mount-points` if you prefer the programmatic approach.

### Project Links

A single mount point can be linked to multiple projects, and a project can reference multiple mount points. This many-to-many arrangement means you need only index your research directory once, then make it available to whichever projects require it — like a shared reference shelf in a well-organized office.

## Searching Documents

Document chunks appear as a new source type in the unified search tool. When a character searches using the `search` tool, document results appear alongside memories and conversation history, ranked by semantic relevance. Each result includes the source file name, the mount point it belongs to, and the heading context (if the document used headings), so you always know precisely where a piece of information came from.

To search only documents, specify `sources: ["documents"]` in the search tool call. To search everything (the default), simply omit the sources parameter.

## In-Chat Navigation

To navigate to The Scriptorium:

```
help_navigate(url: "/scriptorium")
```
