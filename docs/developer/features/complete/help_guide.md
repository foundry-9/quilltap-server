# Feature Spec: Help Dialog — Browseable Guide Tab

## Summary

Add a structured, browseable documentation view to the existing Help dialog, organized as a **"Guide" tab** alongside the current conversational help (renamed to **"Ask"**). The Guide tab presents the existing ~72 help documents as a navigable topic index grouped by functional area, with context-aware sorting that surfaces relevant topics based on the user's current page. No new documentation needs to be written — this feature surfaces content that already exists but is currently invisible to users who don't know to ask for it.

## Problem Statement

The current Help dialog is a conversational interface: a text input, a list of help characters (Riya, Lorian), and a history of past help chats. This works well for **Moment 3** users — those who have a specific problem and can articulate it. But it fails two other critical user moments:

1. **"I just got here, what do I do?"** — New users who finished setup and are staring at the dashboard. They need orientation, not a chat prompt. There is no getting-started content visible in the help dialog.

2. **"How do I do this specific thing?"** — Users who want to learn about a feature (e.g., whispers, the Concierge, clothing records, agent mode) but don't know the right question to ask. They need a browseable index they can scan and click.

The help documentation itself is comprehensive — 72 Markdown files covering every feature, settings tab, and workflow. But it exists only as a search corpus for the help characters' `help_search` tool. A user cannot browse it, discover it, or read it directly. The Guide tab fixes this.

## Design Goals

- **Zero new documentation required.** The Guide tab renders the existing help Markdown files. Writing is done; surfacing is the task.
- **Contextual by default.** When the user opens Help from `/aurora`, character-related topics should float to the top. The URL-matching frontmatter (`url:` field) already exists in every help document for exactly this purpose.
- **Coexists with conversational help.** The "Ask" tab remains exactly as it is today — same characters, same chat interface, same history. The Guide tab is additive, not a replacement.
- **Scannable, not overwhelming.** ~72 documents organized into 10–11 categories with expandable sections. The user should be able to find any topic in 2 clicks: category → topic.
- **Readable in-dialog.** Help content renders as formatted Markdown inside the dialog itself, not in a new page or external link. The dialog is already resizable and movable — this is the right container.

## Proposed UI Structure

### Tab Bar

Add a two-tab bar at the top of the Help dialog, below the "Help" title and close button:

```text
┌──────────────────────────────────────────────┐
│  Help                                    [×] │
│  ┌──────────┐ ┌──────────┐                   │
│  │  Guide   │ │   Ask    │                   │
│  └──────────┘ └──────────┘                   │
│                                              │
│  [tab content here]                          │
│                                              │
└──────────────────────────────────────────────┘
```

- **Guide** is the default tab when the dialog opens (for discoverability).
- **Ask** contains the existing help chat interface (character selection, past chats, input field) — unchanged.
- Tab selection persists for the session (if the user switches to Ask and closes the dialog, reopening shows Ask).

### Guide Tab Layout

The Guide tab has three layers:

#### Layer 1: Category List (default view)

A scrollable list of topic categories, each shown as a card or accordion header. The category relevant to the user's current page is expanded by default; all others are collapsed.

```text
┌──────────────────────────────────────────────┐
│  🔍 [Search topics...]                       │
│                                              │
│  ▸ Getting Started                     (3)   │
│  ▾ Characters (Aurora)                 (9)   │  ← expanded because
│    ├─ Characters Overview                    │     user is on /aurora
│    ├─ Creating Characters                    │
│    ├─ Editing Characters                     │
│    ├─ Character System Prompts               │
│    ├─ Managing Characters                    │
│    ├─ Organizing Characters                  │
│    ├─ Importing & Exporting Characters       │
│    ├─ AI Character Import                    │
│    └─ Refine from Memories                   │
│  ▸ Chats (The Salon)                  (11)   │
│  ▸ Projects (Prospero)                 (5)   │
│  ▸ Files                               (5)   │
│  ▸ Memory & Search                     (2)   │
│  ▸ AI Providers & Connections          (6)   │
│  ▸ Appearance & Themes                 (8)   │
│  ▸ Settings & System                  (14)   │
│  ▸ Your Account                        (4)   │
│  ▸ Content Routing (The Concierge)     (3)   │
│                                              │
└──────────────────────────────────────────────┘
```

Each category shows a disclosure triangle, the category name, and a document count badge.

#### Layer 2: Topic List (expanded category)

When a category is expanded, its topics are listed as clickable rows. Each row shows the document title extracted from the `# Heading` of the Markdown file.

#### Layer 3: Topic Content (reading view)

Clicking a topic opens the document content rendered as formatted Markdown inside the dialog. A back button or breadcrumb returns to the category list.

```text
┌──────────────────────────────────────────────┐
│  ← Characters (Aurora)                       │
│                                              │
│  # Creating Characters                       │
│                                              │
│  This guide walks you through creating new   │
│  characters in Quilltap, from simple         │
│  characters to fully detailed personas.      │
│                                              │
│  ## Getting Started with Character Creation  │
│  ...                                         │
│                                              │
│  [Open this page in Quilltap](/aurora/new)   │
│                                              │
└──────────────────────────────────────────────┘
```

The existing `> **[Open this page in Quilltap](/path)]**` callout at the top of each doc becomes a clickable navigation link that takes the user directly to the relevant page (using the same mechanism as `help_navigate`).

### Search Within Guide

A search input at the top of the Guide tab filters the topic list by title match (simple substring/fuzzy match — not semantic search, which is what the Ask tab's LLM characters do). This is for scanning, not querying. Typing "theme" shows all topics with "theme" in the title. Clearing the search restores the category view.

## Topic Categories and Document Mapping

| Category | Documents (by filename) |
| ---------- | ------------------------ |
| **Getting Started** | `startup-wizard`, `setup-wizard`, `homepage` |
| **Characters (Aurora)** | `characters`, `character-creation`, `character-editing`, `character-system-prompts`, `character-management`, `character-organization`, `character-import-export`, `ai-character-import`, `character-optimizer` |
| **Chats (The Salon)** | `chats`, `chat-multi-character`, `chat-turn-manager`, `chat-participants`, `chat-message-actions`, `chat-state`, `chat-settings`, `templates-in-chats`, `agent-mode`, `rng-tool`, `run-tool`, `shell-tools` |
| **Projects (Prospero)** | `projects`, `project-chats`, `project-files`, `project-characters`, `project-settings` |
| **Files** | `files`, `file-uploads`, `file-organization`, `file-search-preview`, `files-with-ai` |
| **Memory & Search** | `embedding-profiles`, `search` |
| **AI Providers & Connections** | `api-keys-settings`, `connection-profiles`, `image-generation-profiles`, `tools`, `tools-settings`, `tools-usage` |
| **Appearance & Themes** | `appearance-settings`, `themes`, `theme-quick-switcher`, `tags`, `tags-customization`, `quick-hide`, `width-toggle`, `sidebar` |
| **Settings & System** | `settings`, `prompts`, `roleplay-templates`, `roleplay-templates-settings`, `plugins`, `database-protection`, `data-directory`, `system-tools`, `system-backup-restore`, `system-import-export`, `system-llm-logs`, `system-tasks-queue`, `system-capabilities-report`, `system-delete-data` |
| **Your Account** | `profile`, `profile-settings`, `profile-avatar`, `account-information` |
| **Content Routing (The Concierge)** | `dangerous-content`, `story-backgrounds`, `scene-state-tracker` |

The `help-chat` document does not appear in the index — it describes the help dialog itself and would be circular. It can be linked from a small "About this help system" footer link if desired.

## Context-Aware Sorting

### Current Page Detection

The help dialog already receives the current page URL (documented in `help-chat.md`: "the Help Chat knows which page you are currently viewing"). Use this same signal for the Guide tab.

### URL-to-Category Mapping

Each help document has a `url:` frontmatter field. Map the user's current URL to matching documents and boost the category containing those documents:

| Current URL pattern | Boosted category |
| -------------------- | ----------------- |
| `/` | Getting Started |
| `/aurora*` | Characters (Aurora) |
| `/salon*` | Chats (The Salon) |
| `/prospero*` | Projects (Prospero) |
| `/files*` | Files |
| `/profile*` | Your Account |
| `/settings?tab=providers*` | AI Providers & Connections |
| `/settings?tab=chat*` | Chats (The Salon) + Content Routing |
| `/settings?tab=appearance*` | Appearance & Themes |
| `/settings?tab=memory*` | Memory & Search |
| `/settings?tab=images*` | Content Routing (The Concierge) |
| `/settings?tab=templates*` | Settings & System |
| `/settings?tab=system*` | Settings & System |
| `/settings` (no tab) | Settings & System |
| `/setup*` | Getting Started |

The boosted category is **auto-expanded** when the Guide tab opens. All other categories are collapsed. If no URL matches (e.g., a custom route), no category is expanded and the user sees the full collapsed list.

### Within a Category: Document Ordering

Within the boosted category, documents whose `url:` frontmatter exactly matches the current page appear first, followed by the remaining documents in the category's default order (as specified in the mapping table above — this ordering is intentional and should be treated as a curated sequence, not alphabetical).

## Data Source

### Build-Time: Category Index

The category-to-document mapping is defined as a static configuration file (JSON or TypeScript constant) that ships with the application. It does not need to be generated — it is a curated editorial structure. Example:

```typescript
export const HELP_CATEGORIES = [
  {
    id: 'getting-started',
    label: 'Getting Started',
    icon: '🚀', // or a Lucide icon name
    documents: ['startup-wizard', 'setup-wizard', 'homepage'],
  },
  {
    id: 'characters',
    label: 'Characters (Aurora)',
    icon: '🎭',
    urlPatterns: ['/aurora'],
    documents: [
      'characters',
      'character-creation',
      'character-editing',
      'character-system-prompts',
      'character-management',
      'character-organization',
      'character-import-export',
      'ai-character-import',
      'character-optimizer',
    ],
  },
  // ... etc
];
```

### Runtime: Document Content

The help documents are already available at runtime — they're loaded into the help bundle (see `Quilltap Help Index Bundle Feature.md`). The Guide tab reads document titles and content from the same source. If the bundle isn't yet implemented, the Guide tab can fall back to fetching individual Markdown files from `help/*.md` via the existing help file serving mechanism.

The key requirement is that the Guide tab must be able to:

1. List all documents with their titles (extracted from `# H1` heading)
2. Read the `url:` frontmatter for context matching
3. Render the full Markdown content of a selected document

## Markdown Rendering

Help documents should be rendered with the same Markdown renderer used elsewhere in Quilltap (the file preview system already handles Markdown with syntax highlighting, wikilinks, and YAML frontmatter display). Reuse that component.

### Special Handling

- **Navigation callouts** (`> **[Open this page in Quilltap](/path)]**`) should render as a prominent clickable button/link that navigates to the specified page, using `help_navigate` behavior (close the dialog, navigate to the URL).
- **"In-Chat Navigation"** sections at the bottom of each doc should be hidden in the Guide view — they're instructions for the LLM characters, not for human readers.
- **"In-Chat Settings Access"** sections should similarly be hidden — they describe tool usage, not user actions.
- **"Related Topics"** links should be rendered as clickable links that navigate within the Guide tab itself (opening the linked document in the reading view), not as raw Markdown links.
- **Frontmatter** should not be displayed to the user.

## New User Experience

### First-Run Nudge

When the help dialog opens and the user has **fewer than 3 total chats** (indicating a new user), the Guide tab should display a "Welcome" card above the category list:

```text
┌──────────────────────────────────────────────┐
│  👋 Welcome to Quilltap                      │
│                                              │
│  New here? Start with these:                 │
│                                              │
│  → Getting Started with Quilltap             │
│  → AI Stack Setup Wizard                     │
│  → Creating Characters                       │
│  → Chats Overview                            │
│                                              │
│  Or browse the topics below, or switch to    │
│  the Ask tab to chat with a help character.  │
│                                              │
└──────────────────────────────────────────────┘
```

The welcome card links directly to the reading view for each document. It disappears once the user has more than 3 chats (they're no longer "new"). This threshold is a rough heuristic — adjust based on testing.

## Implementation Notes

### Component Structure

```text
HelpDialog (existing)
├── HelpTabBar (new)
│   ├── Tab: "Guide" → HelpGuideTab (new)
│   └── Tab: "Ask"  → HelpAskTab (existing content, moved into tab)
│
├── HelpGuideTab (new)
│   ├── HelpGuideSearch (new) — title-based filtering
│   ├── HelpWelcomeCard (new) — shown for new users
│   ├── HelpCategoryList (new) — accordion of categories
│   │   └── HelpCategorySection (new) — expandable category
│   │       └── HelpTopicRow (new) — clickable topic
│   └── HelpTopicReader (new) — Markdown rendering view
│
└── HelpAskTab (existing)
    ├── HelpCharacterSelector (existing)
    ├── HelpRecentChats (existing)
    └── HelpChatInput (existing)
```

### State Management

- **Active tab** (`guide` | `ask`) — stored in dialog state, persists for session
- **Expanded categories** — stored in dialog state, reset on close
- **Active document** (`null` | document ID) — when set, renders the reading view
- **Search query** — stored in dialog state, cleared on close

### Accessibility

- Tab bar uses `role="tablist"` / `role="tab"` / `role="tabpanel"` ARIA pattern
- Category accordions use `aria-expanded` and `aria-controls`
- Topic list items are keyboard-navigable (arrow keys, Enter to open)
- Back button in reading view is focusable and announced
- Search input has `aria-label="Search help topics"`

### Performance

- Category list and topic titles render instantly from the static index
- Document content loads on demand when a topic is clicked (not all 72 docs at once)
- Search filtering operates on titles only (no content search — that's what the Ask tab is for)

## Dialog Minimum Dimensions

The existing help dialog (`qt-floating-dialog`) currently has a `min-width` of `320px` and a `min-height` of `300px`. These are adequate for the current chat-only interface but far too small for readable documentation content — at 320px, Markdown headings wrap mid-word and code blocks become horizontal scroll traps.

### New Minimums

When the Guide tab is present, enforce the following minimum dimensions on the help dialog:

| Dimension | Current | New Minimum | Rationale |
| ----------- | --------- | ------------- | ----------- |
| `min-width` | `320px` | `480px` | Allows Markdown prose to flow at a readable line length (~50–60 characters). Prevents table and code block overflow in most help documents. Still fits comfortably on a 768px-wide tablet screen with sidebar visible. |
| `min-height` | `300px` | `400px` | Ensures the tab bar, at least one expanded category with 4–5 topic rows, and the search input are all visible without scrolling the dialog's own chrome. In the reading view, guarantees enough vertical space for a heading, an intro paragraph, and the start of the first section — enough for the user to orient before scrolling. |

### Default Open Size

When the dialog first opens (or when no saved size/position exists), it should open at a deliberate default size that provides a good reading and browsing experience out of the box. The current dialog has no intentional default — it opens at whatever size the CSS happens to produce, which is not a designed decision.

| Dimension | Default | Notes |
| ----------- | --------- | ------- |
| `width` | `560px` | Comfortably above the 480px minimum. Provides a reading column of ~65–75 characters per line — the sweet spot for prose readability. Leaves room on most screens for the main Quilltap content to remain visible behind the dialog. |
| `height` | `520px` | Comfortably above the 400px minimum. In the category list view, this shows the search bar, the welcome card (if applicable), and all 11 categories without scrolling. In the reading view, this shows the back-navigation breadcrumb, the document title, the "Open in Quilltap" callout, and roughly 15–20 lines of rendered content before scrolling. |

These defaults apply only when no saved preference exists. Once the user resizes or repositions the dialog, their preference is persisted and used on subsequent opens — this is existing behavior and should not change.

If the user's saved size is smaller than the new minimums (possible if they saved a size before this feature shipped), the dialog should open at the saved position but clamp to the minimum dimensions. This avoids the dialog appearing to "jump" to a new position while still enforcing the floor.

### Resize Behavior

The dialog remains freely resizable above these minimums. The CSS `resize: both` property stays. The constraint is purely a floor — the user can drag the dialog as large as they want but cannot shrink it below the point where content becomes unreadable.

### Responsive Fallback

On viewports narrower than `480px` (e.g., mobile phones), the help dialog should switch to a full-screen overlay mode rather than a floating dialog, since there is no meaningful way to position a floating panel on a screen that small. This is an existing behavior concern for the floating dialog generally, not specific to the Guide tab, but worth noting here as a prerequisite assumption.

## What This Does NOT Change

- The Ask tab is completely untouched — same characters, same chat, same tools, same behavior
- The help characters' `help_search` and `help_settings` tools are unaffected
- The help bundle format (if implemented per the bundle spec) is unaffected — the Guide tab consumes the same data
- No new help documents need to be written
- The help dialog's movable/resizable behavior is unchanged
- The `help-chat.md` document's description of page-aware context still applies to the Ask tab

## Future Considerations

- **Deep linking to Guide topics**: A URL scheme like `?help=character-creation` could open the help dialog directly to a specific topic in the Guide tab. Useful for onboarding flows or error messages that want to point the user at relevant documentation.
- **"Ask about this" button**: In the reading view, a button that switches to the Ask tab with the current document's content pre-loaded as context, so the user can ask follow-up questions to Riya/Lorian about the topic they were just reading.
- **Search within document content**: If the title-based search proves insufficient, add content search — but defer this unless users report difficulty finding topics.
- **Collapsible sections within documents**: Some help docs are very long (e.g., `chat-settings.md`, `character-creation.md`). Consider rendering H2 headings as collapsible sections within the reading view. Defer unless readability is a problem.
- **Print / export**: Allow users to print or export a help topic as a standalone document. Low priority.

## Related

- [[Foundry-9/Quilltap/Quilltap Help Index Bundle Feature]] — Backend bundling of help content for semantic search
- [[Foundry-9/Quilltap/Help Chat Architecture - Lorian & Riya Tandem]] — Conversational help design (the "Ask" tab)
- [[Foundry-9/Quilltap/Settings Page Reorganization]] — Recent settings restructuring that affects help doc URL mappings
- [[Foundry-9/Quilltap/Quilltap]] — Main project page
