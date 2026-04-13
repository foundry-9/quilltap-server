---
url: /settings?tab=system
---

# Document Mount Points

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

## Managing Mount Points

Mount points are managed through the API at `/api/v1/mount-points`. You can:

- **Create** a mount point by providing a name and filesystem path
- **Enable or disable** mount points without deleting their indexed data
- **Trigger a manual re-scan** when you have made changes and do not wish to wait for the next restart
- **Link mount points to projects** so that document search results can be scoped to the relevant collection

### Project Links

A single mount point can be linked to multiple projects, and a project can reference multiple mount points. This many-to-many arrangement means you need only index your research directory once, then make it available to whichever projects require it — like a shared reference shelf in a well-organized office.

## Searching Documents

Document chunks appear as a new source type in the unified search tool. When a character searches using the `search` tool, document results appear alongside memories and conversation history, ranked by semantic relevance. Each result includes the source file name, the mount point it belongs to, and the heading context (if the document used headings), so you always know precisely where a piece of information came from.

To search only documents, specify `sources: ["documents"]` in the search tool call. To search everything (the default), simply omit the sources parameter.

## In-Chat Navigation

To navigate to the system settings where mount points can be managed:

```
help_navigate(url: "/settings?tab=system")
```
