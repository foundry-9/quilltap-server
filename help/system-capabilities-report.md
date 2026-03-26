---
url: /settings?tab=providers&section=capabilities-report
---

# Capabilities Report

> **[Open this page in Quilltap](/settings?tab=providers&section=capabilities-report)**

The Capabilities Report is, if one may be permitted a metaphor, a comprehensive dossier of your entire Quilltap establishment — every cog, spring, and gilded fitting catalogued with the thoroughness of a particularly zealous butler taking inventory after a weekend house party. It gathers the full state of your system into a single document suitable for troubleshooting, bug reports, or simply admiring the scope of what you've built.

## What's in a Capabilities Report?

A capabilities report comprises sixteen meticulously assembled sections, each illuminating a different facet of your installation:

**1. System Information**

The vital statistics of the machine itself — Quilltap version, Node.js version, operating system platform and architecture, total and free memory, runtime type (Docker, Lima, Electron, or plain Node), uptime, data directory path, and timezone. Consider it the identity papers your system carries in its breast pocket.

**2. Database & Security**

Whether your database is secured behind a passphrase, along with the file sizes of both the main database and the LLM logs database. A quick glance at the vaults, as it were.

**3. Backup Status**

Counts and timestamps of physical backups for both the main database and LLM logs database, total backup sizes on disk, and a note about the retention policy. One sleeps better knowing the safety nets are in order.

**4. Plugins**

A manifest of all installed plugins — enabled or disabled — with their version numbers and declared capabilities. The guest list for the machinery ball.

**5. LLM Providers**

A table of your configured AI providers showing which are properly set up and what each can do: chat, image generation, embeddings, and web search. Think of it as the calling cards left on the silver tray.

**6. Models by Provider**

For each configured provider, a listing of the available models — the specific instruments in your orchestra, catalogued by section.

**7. Cost Configuration**

Which models you've designated as your Cheap LLM (for background tasks), Image Prompt LLM, and Embedding Provider. The household budget, transparently laid out.

**8. Image Providers**

Your image generation providers and their available models, for those moments when a thousand words simply will not do.

**9. Embedding Providers**

Embedding providers and their models — the quiet librarians who make semantic search and memory retrieval possible.

**10. MCP Servers**

The names of your configured Model Context Protocol servers, how many are enabled, and reconnect settings. Crucially, server URLs and authentication tokens are never included — a gentleman does not publish the addresses of his secret correspondents.

**11. Theme Information**

Your active theme, color mode preference, theme statistics, and a list of all installed themes. The wallpaper and furnishings of your digital drawing room.

**12. Feature Configuration**

The state of Quilltap's various systems: The Concierge (dangerous content mode, threshold, and scan settings), context compression, agent mode, The Lantern (story backgrounds), timestamp injection, auto-lock, memory cascade, RNG auto-detection, and avatar display settings. Every dial and lever, documented.

**13. Database Statistics**

A census of your data: characters, favorites, chats, messages, memories, tags, projects, connection profiles (broken down by web search, tool use, and dangerous-content compatibility), image profiles, embedding profiles, prompt templates (built-in versus custom), roleplay templates (built-in versus custom), and file permissions. The ledger book of the estate.

**14. Chat Statistics**

Aggregate numbers across all conversations: total estimated cost in USD, total prompt and completion tokens consumed, count of agent mode chats, and count of dangerous content chats. The accountant's summary.

**15. LLM Log Statistics**

Total log entries, cumulative token usage, and logging configuration (whether logging is enabled, verbose mode, and retention policy). The archives, measured and weighed.

**16. Storage Statistics**

Total files managed, total storage consumed, and a breakdown by folder. The inventory of the warehouse.

## Generating a Report

**Step-by-Step:**

1. **Navigate to the AI Providers tab** in Settings (`/settings?tab=providers`)

2. **Find the Capabilities Report section**

3. **Click "Generate Report"**

4. **The system assembles its dossier**
   - Scans all providers and configurations
   - Gathers database statistics
   - Collects feature settings and usage data

5. **Report saved**
   - Appears in the report list
   - Shows creation date and file size
   - Ready to view or download

## Viewing Reports

**View a report in the app:**

1. Find the report in the list
2. Click **View** or **Open**
3. The report displays in a formatted view
4. All sixteen sections presented in order

## Downloading Reports

**Download a report to your computer:**

1. **Find the report** in the Capabilities Report list

2. **Click the Download button**
   - Downloads as a text file
   - File name includes the date generated

3. **Saved to your downloads folder**
   - Store for reference or attach to bug reports
   - Share with support when troubleshooting

## Using Reports for Troubleshooting

The capabilities report was designed with bug reports in mind. When something goes sideways — and in any sufficiently advanced system, something eventually will — a fresh report captures the exact state of affairs at the moment of the mishap.

**When filing a bug report:**

1. **Generate a fresh report** immediately after encountering the issue
2. **Attach the report** to your bug report or support request
3. **The report provides** everything a developer needs to understand your environment without a lengthy back-and-forth interrogation

**When comparing before and after:**

- Generate a report before making changes
- Generate another after
- The two documents together tell the story of what shifted

## Privacy & Security

The Capabilities Report is designed to be safe to share publicly — in bug reports, support threads, or with fellow enthusiasts. It has been carefully constructed to include everything useful for diagnosis while excluding everything sensitive.

**What's NOT in reports:**

- API keys or authentication tokens
- MCP server URLs or authentication credentials
- Database passphrase value
- User email or name
- File contents or message contents
- Connection profile base URLs

**What IS in reports:**

- System configuration and version information
- Database sizes and backup status
- Provider configurations and capabilities
- Feature settings and their current values
- Usage statistics (counts and totals)
- Theme information and installed themes

One may share the report with the confidence of someone who has already had the butler review the guest list for indiscretions.

## Managing Reports

**List of reports shows:**

- Report filename
- Date generated
- File size
- Actions (view, download, delete)

**Actions available:**

**View** - Open report in the application
**Download** - Save report to your computer
**Delete** - Remove report (to save space)

## Troubleshooting Report Generation

**Report generation failed**

- Check that you have available disk space
- Try again after a moment
- If the issue persists, check your logs for errors

**Report looks incomplete**

- Sections for unconfigured features will naturally be sparse
- If a section you expect to see data in appears empty, the underlying feature may not be properly configured
- Generate a new report if you suspect a transient issue

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=providers&section=capabilities-report")`

## Related Topics

- [System Tools](system-tools.md) - Overview of all system tools
- [Connection Profiles](connection-profiles.md) - Configuring providers
- [Plugins](plugins.md) - Installing and managing plugins
