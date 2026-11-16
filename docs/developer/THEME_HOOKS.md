# Theme hooks

<!-- GENERATED FILE — DO NOT EDIT BY HAND. Source: lib/themes/hooks/. Regenerate with `npm run generate:theme-hooks-doc`. -->

The structural hooks a theme's custom CSS may rely on — catalogue version **1**, 219 hooks. Anything not listed here is an implementation detail and may change without notice. The catalogue lives in `lib/themes/hooks/`; `npm run lint` fails when the markup and the catalogue drift apart.

## Conventions

- **Element identity is a `qt-*` class.** One class names one kind of element.
- **Which one of a set is a data attribute named for the set** — `data-section`, `data-nav`, `data-role`, `data-staff`, `data-tab-kind`, `data-tool`, `data-group`, `data-card`, `data-pane`. Values are stable ids, never display text and never instance ids: no character, chat or message id is exposed for styling.
- **State is the ARIA attribute when one says it** (`aria-current`, `aria-selected`, `aria-expanded`, `aria-pressed`, `aria-busy`); otherwise a modifier class (`qt-tab-active`, `qt-chat-message-silent`).
- **The root element** (`<html>`) carries `data-theme` and `data-color-mode` and `.light` / `.dark`. Custom CSS is written without the theme id: Quilltap scopes every rule to `[data-theme="<id>"]` when it loads the theme, stopping at any nested element that wears another theme.
- **Not hooks:** bare elements (`h1`, `button`), non-`qt` classes (Tailwind utilities), class-substring selectors (`[class*="card"]`), and inline-style matches. They work today and break silently.

## Versioning

The catalogue version rises by one in any change that removes a hook, removes a variant value or state, or changes what element a hook names. Adding does not raise it. A removed hook is listed under "Removed hooks" below, with what replaced it.

## App shell

| Class | What it is | Inside | Variants | States |
|---|---|---|---|---|
| `.qt-app-layout` | App layout. The whole signed-in window: the left rail beside the main column. |  |  |  |
| `.qt-skip-link` | Skip-to-content link. Visually hidden until focused. | `.qt-app-layout` |  |  |
| `.qt-app-main` | Main column. Everything right of the left rail: the content and the footer. | `.qt-app-layout` |  |  |
| `.qt-app-content` | Main content (`<main>`). The `<main>` landmark. Inside the signed-in shell it holds the page toolbar and the scroll area; on the setup, unlock and sign-in pages it is the whole page. |  |  |  |
| `.qt-app-scroll` | Content scroll area. The scrolling region under the page toolbar that holds the page or the workspace. | `.qt-app-content` |  |  |
| `.qt-page-toolbar` | Page toolbar. The one global toolbar across the top of the content; it follows the focused workspace pane. | `.qt-app-content` |  |  |
| `.qt-page-toolbar-left` | Page toolbar, left group | `.qt-page-toolbar` |  |  |
| `.qt-page-toolbar-center` | Page toolbar, centre group | `.qt-page-toolbar` |  |  |
| `.qt-page-toolbar-right` | Page toolbar, right group | `.qt-page-toolbar` |  |  |
| `.qt-footer` | Footer. The line at the foot of the main column: version, data directory, copyright. | `.qt-app-main` |  |  |

## Workspace

| Class | What it is | Inside | Variants | States |
|---|---|---|---|---|
| `.qt-workspace` | Workspace. The two-pane tab host: a grid of pane chrome on top, tab content beneath. | `.qt-app-scroll` |  |  |
| `.qt-workspace-backdrop` | Workspace backdrop. The single story background behind both panes. | `.qt-workspace` |  |  |
| `.qt-workspace-backdrop-layer` | Workspace backdrop layer | `.qt-workspace-backdrop` |  |  |
| `.qt-workspace-pane-chrome` | Pane chrome. A pane's tab strip area, above its content. | `.qt-workspace` | `data-pane`: `left`, `right` |  |
| `.qt-tab-strip` | Tab strip | `.qt-workspace-pane-chrome` | `data-pane`: `left`, `right` |  |
| `.qt-tab-select` | Tab button. The focusable part of a workspace tab (icon and title). | `.qt-tab` |  | `aria-selected="true"` / `aria-selected="false"` — The visible tab in its pane |
| `.qt-tab-icon` | Tab icon | `.qt-tab` |  |  |
| `.qt-tab-label` | Tab title | `.qt-tab-select` |  |  |
| `.qt-tab-close` | Tab close button | `.qt-tab` |  |  |
| `.qt-tab-pane` | Tab content. One tab's view. Hidden tabs stay mounted (and carry `hidden`), so scope to the visible one with `:not(.hidden)`. | `.qt-workspace` | `data-pane`: `left`, `right`<br>`data-tab-kind`: `home`, `salon`, `salon-list`, `terminal`, `document`, `aurora`, `prospero`, `scriptorium`, `settings`, `files`, `photos`, `scenarios`, `brahma`, `wardrobe`, `inventory`, `atlas`, `profile`, `about`, `generate-image`, `document-standalone`, `character-new`, `character`, `settings-wizard`, `custom-tools`, `theme-editor`, `theme-specimens` |  |
| `.qt-workspace-divider` | Split divider. The draggable bar between split panes. | `.qt-workspace` |  |  |
| `.qt-workspace-divider-grip` | Split divider grip | `.qt-workspace-divider` |  |  |
| `.qt-workspace-empty` | Empty pane | `.qt-workspace` |  |  |
| `.qt-tab-drop-zone` | Split drop zone. Shown while a tab is dragged in an unsplit workspace. | `.qt-workspace` |  |  |

## Home

| Class | What it is | Inside | Variants | States |
|---|---|---|---|---|
| `.qt-homepage-container` | Home page |  |  |  |
| `.qt-homepage-welcome` | Welcome block. The greeting at the top of the home page. | `.qt-homepage-container` |  |  |
| `.qt-quick-actions` | Quick actions row | `.qt-homepage-container` |  |  |
| `.qt-homepage-grid` | Home card grid. Holds the three home cards side by side. | `.qt-homepage-container` |  |  |
| `.qt-homepage-section` | Home page card | `.qt-homepage-grid` | `data-section`: `chats`, `projects`, `characters` |  |
| `.qt-homepage-section-header` | Home card header | `.qt-homepage-section` |  |  |
| `.qt-homepage-section-title` | Home card title | `.qt-homepage-section-header` |  |  |
| `.qt-homepage-section-link` | Home card "View all" link | `.qt-homepage-section-header` |  |  |
| `.qt-homepage-section-content` | Home card body | `.qt-homepage-section` |  |  |
| `.qt-homepage-row` | Home list row. One chat or project in the Recent Chats or Active Projects card. | `.qt-homepage-section-content` |  |  |
| `.qt-homepage-empty` | Home card empty state | `.qt-homepage-section-content` |  |  |
| `.qt-characters-grid` | Favourite characters grid | `.qt-homepage-section-content` |  |  |
| `.qt-character-card` | Favourite character card | `.qt-characters-grid` |  |  |

## Left rail

| Class | What it is | Inside | Variants | States |
|---|---|---|---|---|
| `.qt-left-sidebar` | Left rail. The permanent icon rail down the left of the window. | `.qt-app-layout` |  | `.qt-left-sidebar-collapsed` — Collapsed (always, today: the rail has no expanded form) |
| `.qt-left-sidebar-content` | Rail navigation area | `.qt-left-sidebar` |  |  |
| `.qt-collapsed-nav` | Rail navigation | `.qt-left-sidebar-content` |  |  |
| `.qt-collapsed-nav-button` | Rail navigation item. An icon link. Its name is in `title` / `aria-label`; there is no text label in the markup. | `.qt-collapsed-nav` | `data-nav`: `home`, `projects`, `files`, `scriptorium`, `characters`, `photos`, `scenarios`, `custom-tools`, `chats` | `aria-current="page"` — The item for the focused workspace pane's active tab (none when nothing corresponds) |
| `.qt-left-sidebar-footer` | Rail footer | `.qt-left-sidebar` |  |  |
| `.qt-left-sidebar-footer-actions` | Rail footer buttons | `.qt-left-sidebar-footer` |  |  |
| `.qt-left-sidebar-item` | Rail footer button | `.qt-left-sidebar-footer-actions` | `data-nav`: `help`, `brahma`, `wardrobe`, `inventory`, `atlas`, `document-mode`, `settings`, `themes`, `quick-hide` | `aria-expanded="true"` / `aria-expanded="false"` — Its popout is open (themes, quick-hide) |
| `.qt-left-sidebar-item-icon` | Rail footer button icon | `.qt-left-sidebar-item` |  |  |
| `.qt-left-sidebar-popout` | Rail popout menu. The menu a footer button or the profile button opens (themes, quick-hide, profile). | `.qt-left-sidebar-footer` |  |  |
| `.qt-left-sidebar-profile` | Profile button | `.qt-left-sidebar-footer` |  | `aria-expanded="true"` / `aria-expanded="false"` — The profile menu is open |
| `.qt-left-sidebar-profile-avatar` | Profile picture | `.qt-left-sidebar-profile` |  |  |

## The Salon

| Class | What it is | Inside | Variants | States |
|---|---|---|---|---|
| `.qt-chat-message-row` | Message row. One message: avatar and bubble. The class alone tells user from not-user (`-user` / `-assistant` below); `data-role` tells a Staff announcement, a tool run and a character line apart. Standalone tool results are `qt-chat-message-row-tool` instead, with `data-role="tool"`. |  | `data-role`: `user`, `assistant`, `staff`, `tool`<br>`data-staff`: `lantern`, `aurora`, `librarian`, `concierge`, `prospero`, `host`, `commonplaceBook`, `ariel`, `carina`, `suparna`, `pascal` |  |
| `.qt-chat-message-row-user` | Message row, user side. Added to a row written from a user seat. Kept beside `data-role` for existing themes. |  |  |  |
| `.qt-chat-message-row-assistant` | Message row, character side. Added to every row not from a user seat — Staff announcements included; use `data-role` to tell them apart. |  |  |  |
| `.qt-chat-message-row-courier` | Courier row. A manual (copy-and-paste) turn awaiting its answer. |  |  |  |
| `.qt-chat-established-fact-row` | Established-fact row. A machine-delivered fact, drawn as a full-width band. |  |  |  |
| `.qt-chat-message-row-tool` | Tool result row. A standalone tool result (not folded into a bubble). Carries `data-role="tool"`. |  | `data-role`: `tool` |  |
| `.qt-chat-desktop-avatar` | Message avatar column. The speaker's picture, name and title beside the bubble. | `.qt-chat-message-row` |  | `.qt-chat-avatar-dangerous` — The chat is Unmoderated |
| `.qt-chat-avatar-carried` | Carried items. The strip of carried-object glyphs under a message avatar. | `.qt-chat-desktop-avatar` |  |  |
| `.qt-chat-message-body` | Message body column | `.qt-chat-message-row` |  |  |
| `.qt-chat-message-user` | User bubble | `.qt-chat-message-body` |  | `.qt-chat-message-whisper` — A whisper<br>`.qt-chat-message-whisper-overheard` — A whisper you overheard<br>`.qt-chat-message-silent` — Written in silent mode<br>`.qt-chat-message-regenerating` — Being regenerated<br>`aria-busy="true"` — Being regenerated |
| `.qt-chat-message-assistant` | Character bubble | `.qt-chat-message-body` |  | `.qt-chat-message-whisper` — A whisper<br>`.qt-chat-message-whisper-overheard` — A whisper you overheard<br>`.qt-chat-message-silent` — Written in silent mode<br>`.qt-chat-message-regenerating` — Being regenerated<br>`aria-busy="true"` — Being regenerated |
| `.qt-chat-message-streaming` | Streaming bubble. The bubble a reply streams into. It does not carry `qt-chat-message-assistant`, whose styling differs; style the two together by listing both. | `.qt-chat-message-body` |  |  |
| `.qt-chat-whisper-label` | Whisper label | `.qt-chat-message-body` |  |  |
| `.qt-chat-silent-label` | Silent-mode label | `.qt-chat-message-body` |  |  |
| `.qt-chat-message-established-fact` | Established-fact ribbon. On a user line posted as established fact. | `.qt-chat-message-body` |  |  |
| `.qt-chat-established-fact-band` | Established-fact band | `.qt-chat-established-fact-row` |  |  |
| `.qt-chat-system-bar` | Staff announcement bar. The header of an expanded Staff announcement; its row carries `data-staff`. | `.qt-chat-message-body` |  | `.qt-chat-system-bar-expanded` — Expanded<br>`aria-expanded="true"` — Expanded |
| `.qt-chat-announcement-group` | Collapsed announcements. A run of collapsed Staff announcements packed into one row of chips. |  |  |  |
| `.qt-chat-announcement-chip` | Staff announcement chip. One collapsed Staff announcement. |  | `data-staff`: `lantern`, `aurora`, `librarian`, `concierge`, `prospero`, `host`, `commonplaceBook`, `ariel`, `carina`, `suparna`, `pascal` | `.qt-chat-announcement-chip-whisper` — A whisper<br>`aria-expanded="false"` — Collapsed (always, for a chip) |
| `.qt-chat-message-action-bar` | Message action bar | `.qt-chat-message-body` |  | `.qt-chat-message-action-bar-disabled` — Actions unavailable |
| `.qt-chat-message-tools` | Folded tool calls. Tool calls shown inside a character's bubble, where they fired. |  |  |  |
| `.qt-chat-pending-tools` | Pending tool calls. The disclosure listing tool calls in flight while a reply streams. |  |  |  |
| `.qt-chat-tool-call` | Tool call card. The card showing one tool call and its result, standalone or folded into a bubble. |  | `data-tool`: any (open set) |  |
| `.qt-chat-tool-embedded` | Folded tool call. A tool call inside a character's bubble. | `.qt-chat-message-tools` |  |  |
| `.qt-chat-composer` | Composer |  |  |  |
| `.qt-chat-composer-input` | Composer input | `.qt-chat-composer` |  |  |
| `.qt-chat-composer-send` | Send button | `.qt-chat-composer` |  |  |
| `.qt-chat-toolbar` | Salon toolbar |  |  |  |
| `.qt-chat-toolbar-button` | Salon toolbar button | `.qt-chat-toolbar` |  | `.qt-chat-toolbar-button-active` — On |
| `.qt-participant-card` | Participant card. One seat in the participant sidebar. |  |  | `.qt-participant-card-active` — Their turn<br>`.qt-participant-card-inactive` — Absent<br>`.qt-participant-card-silent` — Silent<br>`.qt-participant-card-dangerous` — The chat is Unmoderated |
| `.qt-participant-turn-dot` | Turn dot. The small mark beside the seat whose turn it is. |  |  |  |
| `.qt-participant-card-name` | Participant name | `.qt-participant-card` |  |  |
| `.qt-chat-layout` | Salon page. The whole chat view: the message column, the composer, the participant sidebar and any Document or Terminal pane beside them. Its background shows behind the messages. |  |  |  |
| `.qt-chat-messages-list` | Message list. The column of message rows, inside the scrolling viewport. | `.qt-chat-layout` |  |  |
| `.qt-chat-message-content` | Message text. The rendered prose inside a bubble. The roleplay spans (dialogue, narration and the rest) sit inside it. | `.qt-chat-message-user`, `.qt-chat-message-assistant` |  |  |
| `.qt-chat-dialogue` | Dialogue. A roleplay span marking spoken words. The class name is stored in roleplay templates. | `.qt-chat-message-content` |  |  |
| `.qt-chat-narration` | Narration. A roleplay span marking narration. The class name is stored in roleplay templates. | `.qt-chat-message-content` |  |  |
| `.qt-chat-ooc` | Out-of-character aside. A roleplay span marking an out-of-character remark. The class name is stored in roleplay templates. | `.qt-chat-message-content` |  |  |
| `.qt-chat-inner-monologue` | Inner monologue. A roleplay span marking unspoken thought. The class name is stored in roleplay templates. | `.qt-chat-message-content` |  |  |
| `.qt-chat-composer-actions` | Composer actions. The cluster of buttons beside the composer input; Send and Stop sit in it. | `.qt-chat-composer` |  |  |
| `.qt-chat-stop-button` | Stop button. Takes the place of Send while a turn is being written. | `.qt-chat-composer-actions` |  |  |
| `.qt-chat-attachment-chip` | Attachment chip. A file waiting in the composer to be sent. | `.qt-chat-composer` |  |  |
| `.qt-chat-attachment-image` | Attached picture. A picture shown inside a sent message. |  |  |  |
| `.qt-chat-thinking` | Reasoning block. A model's shown reasoning above its answer, opened and closed by its summary line. |  |  |  |
| `.qt-chat-sidebar` | Participant sidebar. The panel of participant cards beside the chat. | `.qt-chat-layout` |  | `.qt-chat-sidebar-collapsed` — Folded to a column of avatars |
| `.qt-courier-bubble` | Courier card. The prompt-and-paste card of a manual (Courier) turn. | `.qt-chat-message-row-courier` |  |  |
| `.qt-green-room` | Green room panel. The panel that narrates a chat's opening while the cast arrives. |  |  | `.qt-green-room-docked` — Docked above the composer |
| `.qt-storyteller-board` | Storyteller board. The board of proposed turns in Storyteller mode. |  |  |  |
| `.qt-storyteller-card` | Storyteller card. One proposed turn on the board. | `.qt-storyteller-board` |  | `.qt-storyteller-card-selected` — Chosen to run<br>`.qt-storyteller-card-quiet` — Holding back this round<br>`.qt-storyteller-card-dragging` — Being dragged |
| `.qt-formatting-toolbar` | Formatting toolbar. The composer's formatting row (bold, italics, roleplay marks); Document Mode's editor uses it too. |  |  |  |
| `.qt-formatting-button` | Formatting button. One button in the formatting toolbar. | `.qt-formatting-toolbar` |  | `.qt-formatting-button-active` — The format is on at the caret |
| `.qt-typeahead-menu` | Mention menu. The menu that opens on @ in the composer. |  |  |  |
| `.qt-typeahead-option` | Mention menu option. One choice in the mention menu. | `.qt-typeahead-menu` |  | `.qt-typeahead-option-active` — Highlighted |
| `.qt-mention-chip` | Mention chip. A named character or Atlas thing, chipped in a message. |  |  | `.qt-mention-chip-thing` — An Atlas thing rather than a character |
| `.qt-doc-pane` | Document pane. Document Mode's pane beside the chat. |  |  |  |
| `.qt-doc-header` | Document pane header. The pane's title row with its buttons. | `.qt-doc-pane` |  |  |

## Character page

| Class | What it is | Inside | Variants | States |
|---|---|---|---|---|
| `.qt-character-page` | Character page. Also carries the older bare `character-page` class. |  |  |  |
| `.qt-character-header` | Character header. The sticky header: back link, avatar, name and meta, actions. | `.qt-character-page` |  |  |
| `.qt-character-avatar` | Character avatar. The avatar region; a menu button for changing the picture. | `.qt-character-header` |  |  |
| `.qt-character-identity` | Character name and meta. Name, favourite star, title, pronouns, age, kind badges, then tags and stats. | `.qt-character-header` |  |  |
| `.qt-character-tags` | Character tags. Alias and group pills. | `.qt-character-identity` |  |  |
| `.qt-character-stats` | Character stats. The counts line (chats, memories, photos, …). | `.qt-character-identity` |  |  |
| `.qt-character-actions` | Character actions. Start a chat, and the action menus. | `.qt-character-header` |  |  |
| `.qt-character-archived-banner` | Archived banner. Shown when the character rests in the archive. | `.qt-character-page` |  |  |
| `.qt-section-card` | Character field section. One card of a character-page section. Also a `qt-card`. | `.qt-character-page` | `data-section`: `facts`, `dossier`, `metadata`, `physical-description`, `scenarios`, `vault`, `conversations`, `memories`, `bulk-edits`, `wardrobe`, `inventory`, `atlas`, `photos`, `depiction-guidelines`, `trust`, `talents`, `wardrobe-permissions`, `control`, `connection-profile`, `conversation-partner`, `image-profile`, `timestamps`, `chat-tools` |  |
| `.qt-section-card-header` | Field section header | `.qt-section-card` |  |  |
| `.qt-section-card-body` | Field section body | `.qt-section-card` |  |  |

## Dialogs

| Class | What it is | Inside | Variants | States |
|---|---|---|---|---|
| `.qt-dialog-overlay` | Dialog backdrop |  |  |  |
| `.qt-dialog` | Dialog. The dialog panel. Also carries `data-qt-modal` and `role="dialog"` or `role="alertdialog"`. | `.qt-dialog-overlay` |  | `.qt-dialog-wide` — Page-width dialog<br>`aria-busy="true"` — Working; Escape and the close button wait |
| `.qt-dialog-header` | Dialog header | `.qt-dialog` |  |  |
| `.qt-dialog-title` | Dialog title | `.qt-dialog-header` |  |  |
| `.qt-dialog-description` | Dialog subtitle | `.qt-dialog-header` |  |  |
| `.qt-dialog-close` | Dialog close button | `.qt-dialog-header` |  |  |
| `.qt-dialog-body` | Dialog body. Always present, and unstyled: the default padding is `qt-dialog-body-default`, which a dialog drops when it lays out its own body. | `.qt-dialog` |  | `.qt-dialog-body-default` — Default padding (the dialog lays out nothing of its own) |
| `.qt-dialog-footer` | Dialog footer. Always present when there are actions, and unstyled: the default look is `qt-dialog-footer-default`. | `.qt-dialog` |  | `.qt-dialog-footer-default` — Default footer look |
| `.qt-floating-dialog` | Floating dialog. A non-modal dialog that floats over the page (the Inform dialog, among others). Modal dialogs are `qt-dialog`. |  |  |  |
| `.qt-slide-over-panel` | Slide-over panel. A panel that slides in from the edge of the window. |  |  |  |

## Settings

| Class | What it is | Inside | Variants | States |
|---|---|---|---|---|
| `.qt-settings-header` | Settings title block |  |  |  |
| `.qt-settings-persona-row` | Staff lens row |  |  |  |
| `.qt-settings-persona-chip` | Staff lens button | `.qt-settings-persona-row` |  | `aria-pressed="true"` / `aria-pressed="false"` — The lens in use |
| `.qt-settings-search` | Settings search |  |  |  |
| `.qt-settings-lens-banner` | Lens banner. Shown while one member of staff's settings are singled out. |  |  |  |
| `.qt-settings-layout` | Settings layout. The rail beside the panel. |  |  |  |
| `.qt-settings-rail` | Settings rail | `.qt-settings-layout` |  |  |
| `.qt-settings-rail-item` | Settings rail item | `.qt-settings-rail` | `data-group`: `connections`, `composer-display`, `context-memory`, `characters-prompts`, `images`, `games-tools`, `moderation`, `appearance`, `security`, `data-maintenance` | `aria-current="page"` — The group on show |
| `.qt-settings-rail-count` | Rail match count. While searching: how many settings in the group match. | `.qt-settings-rail-item` |  |  |
| `.qt-settings-panel` | Settings panel. The selected group's cards. | `.qt-settings-layout` |  |  |
| `.qt-settings-advanced-divider` | Advanced divider | `.qt-settings-panel` |  |  |
| `.qt-collapsible-card` | Settings card. A collapsible card. On the Settings page it carries `data-card`; the same component appears without it elsewhere, so scope by `.qt-settings-panel` or `[data-card]`. |  | `data-card`: `setup-wizard`, `providers`, `api-keys`, `connection-profiles`, `image-profiles`, `embedding-profiles`, `cheap-llm`, `composition-mode`, `composer-spellcheck`, `composer-slash-commands`, `text-replacements`, `smart-typography`, `auto-scroll`, `token-display`, `thinking-display`, `context-compression`, `memory-cascade`, `data-retention`, `memory-extraction-grain`, `memory-recall`, `memory-maintenance`, `memory-backfill`, `memory-regenerate`, `conversation-summaries-regenerate`, `roleplay-templates`, `prompts`, `core-whisper`, `taboo`, `story-backgrounds`, `wardrobe-images`, `default-aesthetics`, `image-description`, `automation`, `custom-tools`, `general-state`, `agent-mode`, `answer-confirmation`, `brahma-console`, `autonomous-rooms`, `autonomous-room-schedules`, `on-duty`, `uncensored-desk`, `refusals`, `display`, `pre-screening`, `appearance`, `avatar-settings`, `calliope`, `tags`, `encryption-passphrase`, `auto-lock`, `delete-all-data`, `plugins`, `backup-restore`, `import-export`, `llm-logging`, `llm-logs`, `tasks-queue`, `capabilities-report` |  |
| `.qt-collapsible-card-header` | Settings card header. The disclosure button. | `.qt-collapsible-card` |  | `aria-expanded="true"` / `aria-expanded="false"` — Open |
| `.qt-collapsible-card-icon` | Settings card icon | `.qt-collapsible-card-header` |  |  |
| `.qt-collapsible-card-chevron` | Settings card chevron | `.qt-collapsible-card-header` |  | `.qt-collapsible-card-chevron-open` — Open |
| `.qt-collapsible-card-body` | Settings card body | `.qt-collapsible-card` |  |  |

## Shared building blocks

| Class | What it is | Inside | Variants | States |
|---|---|---|---|---|
| `.qt-page-container` | Page container. The width-limited column most full pages (Settings, a character, the lists) sit in. |  |  |  |
| `.qt-card` | Card |  |  |  |
| `.qt-card-header` | Card header | `.qt-card` |  |  |
| `.qt-card-title` | Card title |  |  |  |
| `.qt-card-subtitle` | Card subtitle |  |  |  |
| `.qt-card-description` | Card description |  |  |  |
| `.qt-card-interactive` | Clickable card |  |  |  |
| `.qt-button` | Button. The base button; usually paired with a variant class. |  |  |  |
| `.qt-button-primary` | Primary button |  |  |  |
| `.qt-button-secondary` | Secondary button |  |  |  |
| `.qt-button-ghost` | Ghost button |  |  |  |
| `.qt-button-destructive` | Destructive button |  |  |  |
| `.qt-button-success` | Success button |  |  |  |
| `.qt-button-warning` | Warning button |  |  |  |
| `.qt-button-sm` | Small button. A size modifier, beside a variant. |  |  |  |
| `.qt-button-icon` | Icon button |  |  |  |
| `.qt-input` | Text input |  |  | `.qt-input-error` — Invalid |
| `.qt-textarea` | Text area |  |  |  |
| `.qt-select` | Select |  |  |  |
| `.qt-select-sm` | Small select |  |  |  |
| `.qt-badge` | Badge |  |  |  |
| `.qt-badge-primary` | Primary badge |  |  |  |
| `.qt-badge-secondary` | Secondary badge |  |  |  |
| `.qt-badge-success` | Success badge |  |  |  |
| `.qt-badge-warning` | Warning badge |  |  |  |
| `.qt-badge-info` | Info badge |  |  |  |
| `.qt-badge-destructive` | Destructive badge |  |  |  |
| `.qt-badge-outline` | Outline badge |  |  |  |
| `.qt-badge-character` | Character badge |  |  |  |
| `.qt-badge-user-character` | Operator-character badge |  |  |  |
| `.qt-badge-chat` | Chat badge |  |  |  |
| `.qt-badge-tag` | Tag badge |  |  |  |
| `.qt-badge-memory` | Memory badge |  |  |  |
| `.qt-badge-project` | Project badge |  |  |  |
| `.qt-alert` | Alert |  |  |  |
| `.qt-alert-info` | Info alert |  |  |  |
| `.qt-alert-success` | Success alert |  |  |  |
| `.qt-alert-warning` | Warning alert |  |  |  |
| `.qt-alert-error` | Error alert |  |  |  |
| `.qt-heading-1` | Heading, level 1 size |  |  |  |
| `.qt-heading-2` | Heading, level 2 size |  |  |  |
| `.qt-heading-3` | Heading, level 3 size |  |  |  |
| `.qt-heading-4` | Heading, level 4 size |  |  |  |
| `.qt-page-title` | Page title. The large title at the head of a page. |  |  |  |
| `.qt-section-title` | Section title. A heading over a card, panel or settings group. |  |  |  |
| `.qt-text-section` | Section heading text. A smaller section heading inside a form or panel. |  |  |  |
| `.qt-text-brand` | Brand-coloured text. Text in the brand colour: links, the active item, small accents. |  |  |  |
| `.qt-font-brand` | Brand name. The Quilltap name, set in the brand font. |  |  |  |
| `.qt-spinner` | Spinner. A loading spinner; `qt-spinner-sm` beside it for the small one. |  |  |  |
| `.qt-thinking-indicator` | Thinking mark. The mark shown while a model is thinking; it animates by --qt-thinking-duration and --qt-thinking-origin. |  |  |  |
| `.qt-empty-state-title` | Empty-state title. The heading of the notice shown where a list has nothing in it. |  |  |  |
| `.qt-wikilink` | Wiki link. A [[link]] between documents in rendered text. |  |  | `.qt-wikilink-broken` — Points at nothing |
| `.qt-file-preview-panel` | File preview panel. The panel a text file is previewed on. |  |  |  |
| `.qt-diagram` | Diagram. A rendered diagram in a message or document, with its toolbar. |  |  |  |
| `.qt-avatar-image` | Avatar picture box. The framed box holding an avatar picture or its initial. |  |  |  |
| `.qt-avatar-labels` | Avatar caption. Name and title beneath an avatar. |  |  |  |
| `.qt-avatar-name` | Avatar name | `.qt-avatar-labels` |  |  |
| `.qt-avatar-title` | Avatar title | `.qt-avatar-labels` |  |  |
| `.qt-tab-group` | In-page tab group. Entity-page tabs (a character, a project) and small view switchers. |  |  |  |
| `.qt-tab` | Tab. Shared by the workspace tab strip (`.qt-tab-strip .qt-tab`) and the in-page tabs (`.qt-tab-group .qt-tab`): scope by the parent. Only workspace tabs carry `data-tab-kind`. | `.qt-tab-strip`, `.qt-tab-group` | `data-tab-kind`: `home`, `salon`, `salon-list`, `terminal`, `document`, `aurora`, `prospero`, `scriptorium`, `settings`, `files`, `photos`, `scenarios`, `brahma`, `wardrobe`, `inventory`, `atlas`, `profile`, `about`, `generate-image`, `document-standalone`, `character-new`, `character`, `settings-wizard`, `custom-tools`, `theme-editor`, `theme-specimens` | `.qt-tab-active` — The selected tab<br>`.qt-tab-dragging` — Being dragged (workspace) |
| `.qt-empty-state` | Empty state. The "nothing here yet" block; its title is `qt-empty-state-title`. |  |  |  |
| `.qt-empty-state-icon` | Empty state icon | `.qt-empty-state` |  |  |
| `.qt-empty-state-description` | Empty state description | `.qt-empty-state` |  |  |
| `.qt-empty-state-action` | Empty state action. The button or link under an empty state. | `.qt-empty-state` |  |  |
| `.qt-loading-state` | Loading state. The block shown while a list or card is fetched. |  |  |  |
| `.qt-tooltip` | Tooltip |  |  |  |
| `.qt-popover` | Popover. A small anchored panel: a delete confirmation, the character picker. |  |  |  |
| `.qt-entity-card` | Entity card. A character, chat, group or project in a list. |  |  |  |
| `.qt-label` | Field label. A form field's label. |  |  |  |
| `.qt-link` | Link. An ordinary text link. |  |  |  |
| `.qt-checkbox` | Checkbox |  |  |  |
| `.qt-radio` | Radio button |  |  |  |
| `.qt-range` | Slider. A range input. |  |  |  |
| `.qt-prose` | Rendered Markdown. Markdown rendered as prose: messages, previews, help. |  |  |  |
| `.qt-code-block` | Code block. A fenced code block in rendered Markdown. |  |  |  |
| `.qt-code-inline` | Inline code |  |  |  |
| `.qt-progress` | Progress bar. The track. |  |  |  |
| `.qt-progress-fill` | Progress bar fill. The filled part of a progress bar. | `.qt-progress` |  | `.qt-progress-fill-success` — Finished well<br>`.qt-progress-fill-danger` — Failed<br>`.qt-progress-fill-idle` — Waiting |

## Removed hooks

None yet.
