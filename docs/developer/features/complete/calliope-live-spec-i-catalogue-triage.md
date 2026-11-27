# Calliope Live — Spec I Stage 4.1: catalogue triage

**Status:** approved 2026-11-16 — the 45 proposed candidates, as proposed:
Document Mode under `salon` (question 1), kinds written as classes catalogued
as class states (question 2). Nothing from "worth considering", the roleplay
palette included (question 3), was added. Stage 4.2 added the 45 with their
specimens.

## How the list was made

Every `qt-*` token in the `.ts` / `.tsx` files under `app/` and `components/`
(tests, stories and the gallery's own specimens left out — the same file set
the hook lint reads), less every class the catalogue names (174 hooks and
their class states). That leaves **712 classes**, plus 32 names composed from
a template literal (`qt-foo-${…}`), listed at the end. For each class the list
also notes whether any stylesheet under `app/` defines it (**†** = none does).

| Group (decision 2) | Classes |
|---|---|
| 4. Candidates — proposed | 45 hooks, with 11 state classes |
| 4. Candidates — worth considering | 41 classes (31 rows, the roleplay palette as one), with 8 state classes |
| 4. Inner parts of a component, not proposed | 334 |
| 1. A state or modifier of another class | 56 |
| 2. A layout or utility helper | 104 |
| 3. Internal plumbing | 115 |

"Inner parts" is a split of the candidates group that the spec did not name:
classes that do have a look of their own, but name a piece of a component too
small or too internal to promise (a guide page's chevron, a console chip's
remove button). They are listed so that any one may be promoted.

## Questions for the human

1. **Document Mode has no surface.** The `doc-*` candidates are filed under
   `salon` (Document Mode is a Salon mode). The alternative is a new surface,
   `document`, which changes the `HookSurface` type, the surface titles and
   the gallery's grouping — more than "the entry, a specimen and nothing else".
2. **Kinds written as classes.** `qt-mention-chip-thing` and
   `qt-progress-fill-{success,danger,idle}` say *which kind*, which Spec B says
   is a data attribute. Stage 4.2 changes no markup, so the choice is: catalogue
   them as class states (as proposed here), or leave them out until the markup
   carries a `data-*` attribute. The catalogued `qt-badge-*` kinds are a
   precedent for the first.
3. **The roleplay palette.** `qt-roleplay-1`…`-4`, `-danger`, `-warning`,
   `-success`, `-info`, `-muted`, `-code` are the style slots a custom roleplay
   template assigns to its marks; like `qt-chat-dialogue`, their names are
   stored in templates, so they are a contract already. Listed under "worth
   considering" as one block of ten.

## Group 4 — candidates, proposed

`since` is 1 throughout; the catalogue version does not change.

| Class | Surface | Label | Description | States | Written in |
|---|---|---|---|---|---|
| `qt-chat-layout` | salon | Salon page | The whole chat view: the message column, the composer, the participant sidebar and any Document or Terminal pane beside them. Its background is what shows behind the messages. |  | app/salon/[id]/SalonView +1 |
| `qt-chat-messages-list` | salon | Message list | The column of message rows, inside the scrolling viewport. |  | app/salon/[id]/components/VirtualizedMessageList |
| `qt-chat-message-content` | salon | Message text | The rendered prose inside a bubble, under `qt-chat-message-user` / `-assistant`. The roleplay classes below live inside it. |  | components/chat/LazyMessageContent +1 |
| `qt-chat-dialogue` | salon | Dialogue | A roleplay span marking spoken words. The class is a value stored in roleplay templates, so it cannot be renamed anyway. |  | components/settings/roleplay-templates/index |
| `qt-chat-narration` | salon | Narration | A roleplay span marking narration (stored in templates, like Dialogue). |  | components/chat/FormattingToolbar +2 |
| `qt-chat-ooc` | salon | Out-of-character aside | A roleplay span marking an out-of-character remark (stored in templates). |  | components/settings/roleplay-templates/index |
| `qt-chat-inner-monologue` | salon | Inner monologue | A roleplay span marking unspoken thought (stored in templates). |  | components/settings/roleplay-templates/index |
| `qt-chat-composer-actions` | salon | Composer actions | The cluster of buttons beside the composer input (Send sits in it). |  | app/salon/[id]/components/ChatComposer |
| `qt-chat-stop-button` | salon | Stop button | Takes the place of Send while a turn is being written. |  | app/salon/[id]/components/ChatComposer |
| `qt-chat-attachment-chip` | salon | Attachment chip | A file waiting in the composer to be sent. |  | app/salon/[id]/components/ChatComposer |
| `qt-chat-attachment-image` | salon | Attached picture | A picture shown inside a sent message. |  | app/salon/[id]/components/MessageRow +1 |
| `qt-chat-thinking` | salon | Reasoning block | A model's shown reasoning above its answer, opened and closed by its summary line. |  | components/chat/ThinkingBlock |
| `qt-chat-sidebar` | salon | Participant sidebar | The panel of participant cards beside the chat. | `.qt-chat-sidebar-collapsed` — folded to avatars | components/chat/ChatSidebar |
| `qt-courier-bubble` | salon | Courier card | The prompt-and-paste card of a manual (Courier) turn, inside `qt-chat-message-row-courier`. |  | app/salon/[id]/components/CourierBubble |
| `qt-green-room` | salon | Green room panel | The panel that narrates a chat's opening while the cast arrives. Written as `qt-green-room${…}` in `GreenRoomPanel.tsx` (needs `composedIn` or a literal). | `.qt-green-room-docked` — docked above the composer | — |
| `qt-storyteller-board` | salon | Storyteller board | The board of proposed turns in Storyteller mode. |  | components/chat/StorytellerBoard |
| `qt-storyteller-card` | salon | Storyteller card | One proposed turn on the board. | `.qt-storyteller-card-selected`; `.qt-storyteller-card-quiet` (holding back); `.qt-storyteller-card-dragging` | components/chat/StorytellerBoard |
| `qt-formatting-toolbar` | salon | Formatting toolbar | The composer's formatting row (bold, italics, roleplay marks). Also used by Document Mode's editor. |  | components/chat/FormattingToolbar +1 |
| `qt-formatting-button` | salon | Formatting button | One button in the formatting toolbar. | `.qt-formatting-button-active` — the format is on at the caret | components/chat/FormattingToolbar +1 |
| `qt-typeahead-menu` | salon | Mention menu | The menu that opens on `@` in the composer. |  | components/chat/lexical/typeahead/MenuPortal |
| `qt-typeahead-option` | salon | Mention menu option | One choice in that menu. | `.qt-typeahead-option-active` — highlighted | components/chat/lexical/typeahead/MenuPortal |
| `qt-mention-chip` | salon | Mention chip | A named character or Atlas thing, chipped in a message. | `.qt-mention-chip-thing` — an Atlas thing rather than a character (a kind, written as a class; see question 2) | components/chat/MentionChip |
| `qt-doc-pane` | salon | Document pane | Document Mode's pane beside the chat (see question 1 on the surface). |  | app/salon/[id]/components/SplitLayout +1 |
| `qt-doc-header` | salon | Document pane header | The pane's title row with its buttons. |  | app/salon/[id]/components/DocumentPane +2 |
| `qt-footer` | app-shell | Footer | The app's footer line (version, data directory, copyright). |  | components/footer-wrapper |
| `qt-empty-state` | common | Empty state | The "nothing here yet" block. Its title, `qt-empty-state-title`, is already a hook; the block around it is not. |  | components/chat/ChatSidebar +1 |
| `qt-empty-state-icon` | common | Empty state icon |  |  | components/chat/ChatSidebar +1 |
| `qt-empty-state-description` | common | Empty state description |  |  | components/chat/ChatSidebar +1 |
| `qt-empty-state-action` | common | Empty state action | The button or link under it. |  | components/ui/EmptyState |
| `qt-loading-state` | common | Loading state | The "loading…" block shown while a list or card fetches (29 places). |  | app/aurora/[id]/components/ExternalPromptDialog +28 |
| `qt-tooltip` | common | Tooltip | The shared tooltip bubble. |  | components/ui/Tooltip |
| `qt-popover` | common | Popover | A small anchored panel (delete confirmations, the character picker). |  | components/chat/char-insert/CharPickerPanel +1 |
| `qt-floating-dialog` | dialog | Floating dialog | A non-modal dialog that floats over the page (Inform, among others); the modal `qt-dialog` family is already catalogued. |  | components/chat/InformDialog +1 |
| `qt-slide-over-panel` | dialog | Slide-over panel | A panel that slides in from the edge. |  | components/ui/SlideOverPanel |
| `qt-entity-card` | common | Entity card | A character, chat, group or project in a list (Aurora, project tabs). |  | app/aurora/AuroraView +7 |
| `qt-label` | common | Field label | A form field's label (106 places). `qt-input`, `qt-select` and `qt-textarea` are hooks; their labels are not. |  | app/aurora/AuroraView +105 |
| `qt-link` | common | Link | An ordinary text link. |  | app/about/AboutView +13 |
| `qt-checkbox` | common | Checkbox |  |  | app/salon/[id]/components/DocumentPickerModal +67 |
| `qt-radio` | common | Radio button |  |  | app/scriptorium/components/CreateDocumentStoreDialog +10 |
| `qt-range` | common | Slider | A range input. |  | app/aurora/[id]/components/ExternalPromptDialog +8 |
| `qt-prose` | common | Rendered Markdown | Markdown rendered as prose (messages, previews, help). |  | components/chat/LazyMessageContent +1 |
| `qt-code-block` | common | Code block | A fenced code block in rendered Markdown. |  | app/salon/[id]/components/MessageRow +1 |
| `qt-code-inline` | common | Inline code |  |  | app/aurora/[id]/components/VaultRepairCard +3 |
| `qt-progress` | common | Progress bar | The track. |  | components/custom-tools/ProvingBench +2 |
| `qt-progress-fill` | common | Progress bar fill | The filled part. | `.qt-progress-fill-success`, `-danger`, `-idle` — kinds, written as classes (question 2) | components/custom-tools/ProvingBench +2 |

## Group 4 — candidates, worth considering

| Class | Surface | What it is | States |
|---|---|---|---|
| `qt-chat-scroll-to-bottom` | salon | "Jump to latest" button |  |
| `qt-chat-response-status` | salon | Response status line (who is answering) |  |
| `qt-chat-message-editor` | salon | Inline message editor |  |
| `qt-chat-sidebar-header` | salon | Participant sidebar header |  |
| `qt-participant-status-overlay` | salon | Absent / silent overlay on a participant avatar | `-absent`, `-silent` |
| `qt-doc-title` | salon | Document pane title |  |
| `qt-doc-toolbar` | salon | Document pane toolbar |  |
| `qt-doc-status-bar` | salon | Document pane status bar |  |
| `qt-doc-divider` | salon | Divider between chat and Document pane | `-active` (being dragged) |
| `qt-terminal-surface` | salon | Terminal Mode's terminal (xterm draws inside; only the frame is ours) |  |
| `qt-footer-link` | app-shell | Link in the footer |  |
| `qt-tooltip-title` | common | Tooltip title |  |
| `qt-tooltip-body` | common | Tooltip body |  |
| `qt-floating-dialog-header` | dialog | Floating dialog header |  |
| `qt-floating-dialog-title` | dialog | Floating dialog title |  |
| `qt-floating-dialog-body` | dialog | Floating dialog body |  |
| `qt-slide-over-header` | dialog | Slide-over panel header |  |
| `qt-tag-badge` | common | Tag chip (the tag editor's; `qt-badge-tag` is the catalogued read-only one) |  |
| `qt-copy-button` | common | Copy-to-clipboard button | `-success` (just copied) |
| `qt-filter-chip` | common | Search dialog filter chip | `-active` |
| `qt-help-msg-user` | common | Help chat: your message |  |
| `qt-help-msg-assistant` | common | Help chat: the answer |  |
| `qt-help-composer` | common | Help chat composer |  |
| `qt-frontmatter` | common | Frontmatter table at the top of a Markdown document |  |
| `qt-gallery-caption` | common | Caption under a gallery picture |  |
| `qt-settings-section-heading` | settings | Heading inside a settings card |  |
| `qt-settings-provider-card` | settings | A provider card on the Providers page |  |
| `qt-navbar-dropdown-item` | app-shell | Item in the user menu | `-active` |
| `qt-autonomous-badge` | app-shell | Autonomous-room status badge in the header | `-running`, `-idle` |
| `qt-badge-muted` | common | Muted badge (follows the catalogued `qt-badge-*` kinds; defined in no CSS today) |  |
| `qt-badge-disabled` | common | Disabled badge |  |
| `qt-roleplay-1` `qt-roleplay-2` `qt-roleplay-3` `qt-roleplay-4` `qt-roleplay-danger` `qt-roleplay-warning` `qt-roleplay-success` `qt-roleplay-info` `qt-roleplay-muted` `qt-roleplay-code` | salon | The roleplay template palette (question 3) | |
## Group 4 — inner parts of a component, not proposed

Pieces of an element that is itself a candidate, already a hook, or not proposed. Any may be promoted.

| Family | Classes (`qt-` dropped; † = no CSS) | Written in |
|---|---|---|
| `qt-action` | `action` | app/aurora/[id]/CharacterHeader +4 |
| `qt-autonomous` | `autonomous-badge-button` `autonomous-badge-group` | components/layout/autonomous-room-badges |
| `qt-badge` | `badge-auto` `badge-autonomous-budget` `badge-capability` `badge-manual` `badge-message` `badge-provider-builtin` `badge-provider-nanogpt` `badge-provider-ollama` `badge-provider-openai` `badge-provider-openrouter` `badge-related` `badge-wardrobe-shared` | components/search/search-results +1; components/tools/autonomous-rooms-card; components/settings/plugins-tab |
| `qt-border` | `border` | app/prospero/[id]/components/CharactersCard +12 |
| `qt-brahma` | `brahma-launcher-icon` | components/brahma-console/BrahmaConsoleLauncher |
| `qt-chat` | `chat-announcement-dot` `chat-attachment-button` `chat-attachment-chip-icon` `chat-attachment-chip-remove` `chat-attachment-list` `chat-attachment-overlay` `chat-composer-content` `chat-composer-established-fact` `chat-composer-inner` `chat-concepts` `chat-concepts-anchor` `chat-concepts-group-label` `chat-concepts-item` `chat-concepts-list` `chat-concepts-name` `chat-concepts-term` `chat-concepts-text` `chat-concepts-thumb` `chat-continue-button` `chat-established-fact` `chat-established-fact-toggle` `chat-message-action-bar-icons` `chat-message-action-icon` `chat-message-action-timestamp` `chat-message-editor-actions` `chat-message-editor-notice` `chat-message-editor-option` `chat-message-tools-before-prose` `chat-pause-button` `chat-regenerating` `chat-regenerating-plate` `chat-regenerating-plate-text` `chat-response-status-icon` `chat-response-status-text` `chat-sidebar-add` `chat-sidebar-collapsed-avatar` `chat-sidebar-collapsed-avatars` `chat-sidebar-collapsed-pause` `chat-sidebar-collapsed-position-badge` `chat-sidebar-heading` `chat-sidebar-list` `chat-sidebar-meta` `chat-sidebar-queue` `chat-sidebar-toggle` `chat-system-bar-kind` `chat-system-bar-sender` `chat-system-bar-time` `chat-system-bar-whisper` `chat-thinking-body` `chat-thinking-chevron` `chat-thinking-details` `chat-thinking-summary` `chat-tool-result-chip` `chat-toolbar-row` `chat-wardrobe-label` `chat-wardrobe-notice` `chat-wardrobe-summary` | app/salon/[id]/components/AnnouncementChip; app/salon/[id]/components/MessageRow +1; app/salon/[id]/components/ChatComposer +2 |
| `qt-code` | `code-block-container` `code-block-copy` | components/chat/CodeBlockWithCopy |
| `qt-composer` | `composer-gutter-button` `composer-gutter-column` `composer-gutter-rng` `composer-gutter-tools` | components/chat/ComposerGutterTools +2; app/salon/[id]/components/ChatComposer; components/chat/ComposerGutterTools |
| `qt-concierge` | `concierge-mark` | components/chat/ConciergeMark |
| `qt-confirmation` | `confirmation-badge` `confirmation-badge-glyph` | app/salon/[id]/components/message-row/ConfirmationBadge |
| `qt-console` | `console-attachment-chip` `console-attachment-image` `console-attachment-remove` `console-attachment-row` `console-attachment-thumb` `console-composer-attach` `console-context-bar` `console-context-chip` `console-context-chip-remove` `console-modal-layer` `console-notes` `console-notice` `console-output-body` `console-output-source` `console-output-toolbar` `console-output-view` `console-writing-badge` `console-writing-switch-label` `console-writing-switch-track` | components/brahma-console/ConsoleMessageAttachments; components/help-chat/HelpChatComposer; components/brahma-console/ConsoleMessageAttachments +1 |
| `qt-copy` | `copy-button-icon` `copy-button-text` | components/files/FilePreview/FilePreviewText +2; components/chat/CodeBlockWithCopy +1 |
| `qt-courier` | `courier-bubble-actions` `courier-bubble-attachment-meta` `courier-bubble-attachments-label` `courier-bubble-attachments-list` `courier-bubble-error` `courier-bubble-header` `courier-bubble-hint` `courier-bubble-mode-badge` `courier-bubble-paste-label` `courier-bubble-prompt` `courier-bubble-prompt-body` `courier-bubble-prompt-toolbar` `courier-bubble-textarea` `courier-bubble-title` | app/salon/[id]/components/CourierBubble |
| `qt-diagram` | `diagram-canvas` `diagram-error` `diagram-error-details` `diagram-error-note` `diagram-lightbox` `diagram-lightbox-bar` `diagram-lightbox-button` `diagram-lightbox-check` `diagram-lightbox-group` `diagram-lightbox-hint` `diagram-lightbox-sheet` `diagram-lightbox-viewport` `diagram-lightbox-zoom` `diagram-placeholder` `diagram-stage` `diagram-toolbar` `diagram-toolbar-button` | components/chat/diagrams/DiagramBlock; components/chat/diagrams/DiagramLightbox |
| `qt-doc` | `doc-badge` `doc-chat-pane` `doc-code-editor` `doc-editor-area` `doc-gutter` `doc-gutter-change` `doc-gutter-eye` `doc-header-button` `doc-open-button` `doc-split-layout` `doc-status-item` `doc-title-input` `doc-uri-copy-button` `doc-uri-label` `doc-uri-row` `doc-uri-value` `doc-vertical-divider` `doc-vertical-pane` `doc-vertical-split-layout` | app/salon/[id]/components/DocumentPane +1; app/salon/[id]/components/SalonModePanes +1; app/salon/[id]/components/DocumentPane |
| `qt-emoji` | `emoji-picker` `emoji-picker-cell` `emoji-picker-grid` `emoji-picker-group-header` `emoji-picker-message` `emoji-picker-row` `emoji-picker-search` | components/chat/char-insert/CharPickerPanel |
| `qt-entity` | `entity-card-actions` | app/aurora/AuroraView +3 |
| `qt-file` | `file-preview-code` `file-preview-empty` `file-preview-empty-icon` `file-preview-loading` `file-preview-loading-text` `file-preview-scroll` `file-preview-text-container` | components/files/FilePreview/FilePreviewText |
| `qt-floating` | `floating-dialog-actions` `floating-dialog-close` | components/ui/FloatingDialog |
| `qt-footer` | `footer-container` `footer-path` `footer-separator` | components/footer-wrapper |
| `qt-formatting` | `formatting-button-emoji` `formatting-button-indent` `formatting-button-outdent` `formatting-button-source` `formatting-toolbar-divider` `formatting-toolbar-section` | components/chat/FormattingToolbar +1; components/chat/FormattingToolbar |
| `qt-frontmatter` | `frontmatter-chip-list` `frontmatter-table` `frontmatter-title` | app/salon/[id]/components/DocumentPane; app/salon/[id]/components/DocumentPane +1 |
| `qt-gallery` | `gallery-caption-detail` `gallery-caption-title` | components/document-browser/DocumentTile +2 |
| `qt-green` | `green-room-activity` `green-room-activity-label` `green-room-body` `green-room-character` `green-room-character-line` `green-room-character-name` `green-room-character-note` `green-room-close` `green-room-disclosure` `green-room-header` `green-room-headline` `green-room-log` `green-room-log-list` `green-room-log-time` `green-room-spinner` `green-room-status` `green-room-title` `green-room-toggle` | app/salon/[id]/components/GreenRoomPanel |
| `qt-help` | `help-avatar` `help-char-pill` `help-composer-input` `help-composer-send` `help-entity-picker` `help-entity-picker-backdrop` `help-entity-picker-filter` `help-entity-picker-header` `help-entity-picker-item` `help-entity-picker-list` `help-error` `help-guide-back` `help-guide-category` `help-guide-category-badge` `help-guide-category-chevron` `help-guide-category-header` `help-guide-category-label` `help-guide-category-topics` `help-guide-code-block` `help-guide-deco` `help-guide-doc-link` `help-guide-inline-code` `help-guide-nav-callout` `help-guide-page-link` `help-guide-reader` `help-guide-search` `help-guide-search-clear` `help-guide-search-icon` `help-guide-search-input` `help-guide-topic` `help-msg-character-name` `help-nav-button` `help-past-chat` `help-section-label` `help-suggested-link` `help-suggested-links` `help-suggested-links-label` `help-tail` `help-tail-assistant` `help-tail-user` `help-welcome-card` `help-welcome-footer` `help-welcome-link` `help-welcome-links` `help-welcome-text` `help-welcome-title` | components/brahma-console/BrahmaConsoleMessageList +1; components/help-chat/HelpChatDialog; components/help-chat/HelpChatComposer |
| `qt-intervene` | `intervene-toggle` | components/custom-tools/InterventionToggle |
| `qt-intervention` | `intervention` `intervention-badge` `intervention-effect` `intervention-mark` `intervention-note` `intervention-queue` `intervention-reset` `intervention-row` `intervention-section` | components/chat/CustomToolInterventionDialog; app/salon/[id]/components/AnnouncementChip; components/custom-tools/WorkbenchLibrary |
| `qt-navbar` | `navbar-dropdown-label` `navbar-dropdown-section` `navbar-toggle` | components/dashboard/nav-user-menu-quick-hide; components/dashboard/nav-content-width-toggle |
| `qt-participant` | `participant-avatar-tool-button` `participant-avatar-tools` `participant-card-actions` `participant-card-header` `participant-card-info` `participant-card-status` `participant-position-badge` `participant-queue-badge` `participant-turn-indicator` | components/chat/ParticipantCard |
| `qt-pascal` | `pascal-result` | app/salon/[id]/components/system-message-labels +3 |
| `qt-qtap` | `qtap-doc` | components/qtap/QtapLink |
| `qt-queue` | `queue-badge-group` | components/layout/queue-status-badges |
| `qt-rp` | `rp-annotation-button` | components/chat/FormattingToolbar +1 |
| `qt-settings` | `settings-attention` `settings-attention-chip` `settings-persona-badge` `settings-provider-card-add` `settings-provider-card-body` `settings-provider-card-chevron` `settings-provider-card-header` `settings-provider-card-summary` `settings-provider-card-title` `settings-provider-kind-badge` `settings-provider-profile-list` `settings-provider-profile-model` `settings-provider-profile-row` `settings-rail-select` | components/settings/AttentionStrip; components/settings/PersonaBadge; components/settings/cards/providers-by-provider |
| `qt-slide` | `slide-over-overlay` | components/ui/SlideOverPanel |
| `qt-source` | `source-mode-textarea` | app/salon/[id]/components/ChatComposer |
| `qt-storyteller` | `storyteller-actions` `storyteller-board-header` `storyteller-board-tools` `storyteller-card-act` `storyteller-card-destroy` `storyteller-card-head` `storyteller-card-name` `storyteller-card-order` `storyteller-cards` `storyteller-meta` `storyteller-mode` `storyteller-mode-option` `storyteller-plan` `storyteller-summary` `storyteller-warning` | components/chat/StorytellerBoard; components/chat/ChatSidebar |
| `qt-tab` | `tab-close-icon` | components/workspace/TabStrip |
| `qt-tag` | `tag-badge-emoji` `tag-badge-md` `tag-badge-remove` `tag-badge-sm` | components/tags/tag-badge; components/settings/chat-settings/TabooSettings +1 |
| `qt-terminal` | `terminal-closed-badge` `terminal-embed` `terminal-embed-footer` `terminal-embed-header` | components/terminal/Terminal; components/terminal/TerminalEmbed |
| `qt-text` | `text` | app/aurora/AuroraView +185 |
| `qt-theme` | `theme-preview-surface` | components/settings/appearance/components/ThemePreviewModal +1 |
| `qt-tool` | `tool-card-chevron` `tool-card-preview` `tool-card-summary` `tool-palette-badge` `tool-palette-button` | components/brahma-console/BrahmaToolCall; components/chat/ChatSidebar; components/chat/ChatScenarioControl +4 |
| `qt-tooltip` | `tooltip-hint` `tooltip-image` `tooltip-markdown` `tooltip-quote` `tooltip-section` `tooltip-section-label` | app/salon/[id]/components/message-row/ConfirmationBadge +3; components/chat/MentionChip; app/salon/[id]/components/message-row/ConfirmationBadge +2 |
| `qt-typeahead` | `typeahead-empty` `typeahead-option-detail` `typeahead-option-glyph` `typeahead-option-label` | components/chat/lexical/typeahead/MenuPortal |
| `qt-workspace` | `workspace-empty-hint` | components/workspace/WorkspaceHost |

## Group 1 — a state or modifier of another class

Modifier classes (`-active`, `-open`, `-running`, …) whose base is not a candidate. Those whose base is a candidate are proposed with it above. None of them sits on a catalogued hook as an uncatalogued state.

| Family | Classes (`qt-` dropped; † = no CSS) | Written in |
|---|---|---|
| `qt-badge` | `badge-absent` `badge-autonomous-error` `badge-autonomous-idle` `badge-autonomous-paused` `badge-autonomous-running` `badge-autonomous-stopped` `badge-silent` | components/chat/ParticipantCard; components/tools/autonomous-rooms-card |
| `qt-brahma` | `brahma-launcher-active` | components/brahma-console/BrahmaConsoleLauncher |
| `qt-chat` | `chat-attachment-chip-icon-info` `chat-attachment-chip-icon-success` `chat-concepts-thumb-empty` `chat-interrupt-button-raised` `chat-message-action-icon-danger` `chat-pause-button-paused` `chat-sidebar-collapsed-avatar-active` `chat-sidebar-collapsed-avatar-inactive` `chat-sidebar-collapsed-avatar-streaming` `chat-sidebar-collapsed-pause-paused` `chat-thinking-start` | app/salon/[id]/components/ChatComposer +2; app/salon/[id]/components/ChatComposer; components/chat/ChatConceptsNamed |
| `qt-console` | `console-attachment-chip-error` `console-attachment-chip-missing` `console-attachment-row-sent` `console-composer-dragover` `console-context-chip-derived` `console-context-chip-missing` `console-output-draft` `console-output-saved` `console-output-view-on` `console-writing-switch-on` | components/help-chat/HelpChatComposer; components/brahma-console/ConsoleMessageAttachments; components/brahma-console/ConsoleContextBar |
| `qt-doc` | `doc-status-saved` `doc-status-saving` `doc-vertical-divider-active` | app/salon/[id]/components/DocumentPane; app/salon/[id]/components/RightPaneVerticalSplit |
| `qt-dot` | `dot-success` `dot-warning` | app/scriptorium/[id]/DocumentStoreDetailView +1 |
| `qt-floating` | `floating-dialog-topmost` | components/ui/FloatingDialog |
| `qt-green` | `green-room-packed` `green-room-pulse` | app/salon/[id]/components/GreenRoomPanel |
| `qt-help` | `help-guide-category-chevron-open` `help-guide-topic-active` | components/help-chat/HelpCategorySection |
| `qt-navbar` | `navbar-dropdown-item-active` `navbar-toggle-active` | components/dashboard/nav-user-menu-quick-hide; components/dashboard/nav-content-width-toggle |
| `qt-participant` | `participant-position-eligible` `participant-position-generating` `participant-position-next` `participant-position-queued` `participant-position-spoken` `participant-position-user-turn` | components/chat/ChatSidebar +1 |
| `qt-queue` | `queue-badge-idle` `queue-badge-pulse` | components/layout/queue-status-badges |
| `qt-settings` | `settings-provider-card-chevron-open` | components/settings/cards/providers-by-provider |
| `qt-storyteller` | `storyteller-card-draggable` `storyteller-mode-option-active` `storyteller-mode-option-paused` | components/chat/StorytellerBoard; components/chat/ChatSidebar |
| `qt-tool` | `tool-palette-badge-off` `tool-palette-badge-on` `tool-palette-button-danger` | components/chat/ChatSidebar |

## Group 2 — layout and utility helpers

No element identity of their own: the `qt-bg-*` / `qt-text-*` / `qt-border-*` / `qt-shadow-*` utilities, type and spacing helpers, and layout wrappers such as `qt-chat-main` and `qt-chat-messages-viewport`. A theme reaches these through tokens.

| Family | Classes (`qt-` dropped; † = no CSS) | Written in |
|---|---|---|
| `qt-about` | `about-intro` | app/about/AboutView |
| `qt-alert` | `alert-destructive`† | components/settings/connection-profiles/ProfileModal |
| `qt-bg` | `bg-accent` `bg-card` `bg-default` `bg-destructive` `bg-info` `bg-input` `bg-muted` `bg-muted-foreground` `bg-overlay` `bg-overlay-btn` `bg-overlay-caption` `bg-overlay-light` `bg-overlay-medium` `bg-overlay-none` `bg-popover` `bg-primary` `bg-secondary` `bg-success` `bg-surface` `bg-surface-alt` `bg-surface-hover` `bg-toggle-knob` `bg-warning` | components/chat/EntitySearchDropdown +6; app/aurora/AuroraView +44; app/aurora/[id]/components/ExternalPromptResultDialog +26 |
| `qt-body` | `body` `body-sm` | app/scenarios/ScenariosView +11; app/salon/SalonListView +5 |
| `qt-border` | `border-accent` `border-default` `border-destructive` `border-info` `border-input` `border-primary` `border-primary-foreground` `border-success` `border-warning` | components/settings/ai-import/AIImportWizard; app/aurora/AuroraView +197; app/aurora/[id]/cards/MetadataCard +24 |
| `qt-button` | `button-danger`† `button-danger-outline`† | components/state/StateEditorModal +1; components/state/StateEditorModal |
| `qt-callout` | `callout`† | app/scriptorium/components/ConvertToDatabaseDialog +1 |
| `qt-caption` | `caption` | components/characters/optimizer/CharacterOptimizerModal +2 |
| `qt-card` | `card-content`† `card-grid-auto` `card-selected`† | components/profile/DataDirectorySection +2; components/settings/api-keys-tab +4; components/chat/SelectLLMProfileDialog |
| `qt-chat` | `chat-main` `chat-messages` `chat-messages-viewport` | app/salon/[id]/SalonView; app/salon/[id]/components/VirtualizedMessageList |
| `qt-code` | `code`† | components/characters/optimizer/CharacterOptimizerModal +3 |
| `qt-collapsible` | `collapsible-card-divider` | components/ui/CollapsibleCard |
| `qt-divide` | `divide-default` | components/characters/RenameReplaceTab +3 |
| `qt-divider` | `divider`† | components/loading/StartupProgress |
| `qt-focus` | `focus-ring` | app/aurora/AuroraView +18 |
| `qt-form` | `form-label`† | app/salon/[id]/components/SaveImageDialog |
| `qt-heading` | `heading-lg` `heading-sm` | components/startup/instance-lock-gate +1; components/ui/MemoryCascadeDialog |
| `qt-helper` | `helper` | components/characters/optimizer/CharacterOptimizerModal |
| `qt-highlight` | `highlight` | components/custom-tools/OutcomesSection +1 |
| `qt-hint` | `hint` | components/characters/progressions/ProgressionEditorModal +8 |
| `qt-hover` | `hover-accent` | components/brahma-console/BrahmaConsolePanel +28 |
| `qt-icon` | `icon` | components/ui/icon |
| `qt-input` | `input-sm`† | components/atlas/AtlasBrowser +15 |
| `qt-list` | `list-row`† | app/salon/[id]/components/TerminalSessionPicker |
| `qt-markdown` | `markdown` | components/files/FilePreview/FilePreviewDocx +1 |
| `qt-meta` | `meta` | components/homepage/ProjectItem +1 |
| `qt-option` | `option-selected` `option-unselected` | app/setup/profile/page +3 |
| `qt-panel` | `panel` | components/images/image-detail/ImageMetadata +1 |
| `qt-progress` | `progress-indeterminate` `progress-sm` | components/ui/ProgressBar; components/custom-tools/ProvingBench +1 |
| `qt-prose` | `prose-auto` | components/characters/ai-wizard/steps/GenerationStep +6 |
| `qt-ring` | `ring-brand` | components/characters/ai-wizard/AIWizardModal +6 |
| `qt-section` | `section-subtitle` | components/characters/optimizer/CharacterOptimizerModal +1 |
| `qt-settings` | `settings-field-group` `settings-shell` `settings-toggle-row` | components/settings/chat-settings/SmartTypographySettings +2; components/settings/chat-settings/SmartTypographySettings +3; components/settings/chat-settings/AutoScrollSettings +5 |
| `qt-shadow` | `shadow-lg` `shadow-md` `shadow-sm` | app/aurora/[id]/cards/ScenariosCard +19; app/photos/PhotosView +5; app/aurora/AuroraView +22 |
| `qt-spinner` | `spinner-sm` | components/settings/embedding-profiles/ProfileModal +10 |
| `qt-tab` | `tab-divider` | components/help-chat/HelpChatDialog +1 |
| `qt-text` | `text-danger` `text-destructive` `text-favorite` `text-info` `text-label` `text-label-xs` `text-large` `text-muted` `text-on-accent` `text-on-destructive` `text-on-primary` `text-on-success` `text-overlay` `text-overlay-muted` `text-primary` `text-secondary` `text-small` `text-success` `text-warning` `text-xs` | app/aurora/[id]/components/RehydrateBundleDialog +5; app/aurora/AuroraView +142; app/aurora/AuroraView +3 |
| `qt-toggle` | `toggle-off` | app/prospero/[id]/components/CharactersCard +4 |
| `qt-warning` | `warning-box` | components/chat/ChatToolSettingsModal |
| `qt-workspace` | `workspace-backdrop-left` `workspace-backdrop-right` `workspace-divider-cell` | components/workspace/workspace-backdrop; components/workspace/WorkspaceHost |

## Group 3 — internal plumbing

Markers with no look (test and selection anchors, portal hosts), the code editor's and Lexical's internal class maps, screens drawn before any theme loads (`qt-pretheme-bg`, `qt-auth-page`), and resizers and grips whose look is the drag affordance.

| Family | Classes (`qt-` dropped; † = no CSS) | Written in |
|---|---|---|
| `qt-accent` | `accent-primary`† | app/aurora/[id]/cards/PhysicalDescriptionCard +1 |
| `qt-atlas` | `atlas-tab`† | components/item-browser/ItemControlDialogShell |
| `qt-auth` | `auth-page` | app/setup/page +3 |
| `qt-badge` | `badge-provider`† `badge-wardrobe`† | components/settings/embedding-profiles/ProviderBadge +1; components/wardrobe/OutfitSlotsPreview |
| `qt-chat` | `chat-announcement-chip-wrap` `chat-concepts-group`† `chat-regenerating-original` `chat-sidebar-cards`† `chat-sidebar-debug` `chat-sidebar-overlay` `chat-sidebar-resizer` `chat-sidebar-resizer-active` `chat-sidebar-resizer-grip` `chat-sidebar-section`† `chat-sidebar-section-chat`† `chat-sidebar-section-edit`† `chat-sidebar-section-organize`† `chat-sidebar-section-participants`† `chat-sidebar-section-visibility`† `chat-speaker-selector`† `chat-system-bar-chevron-down`† `chat-thinking-label`† `chat-user-turn-banner`† | app/salon/[id]/components/AnnouncementChip; components/chat/ChatConceptsNamed; app/salon/[id]/components/MessageRow |
| `qt-code` | `code-editor-band` `code-editor-body` `code-editor-code` `code-editor-content` `code-editor-gutter` `code-editor-line-numbers` `code-editor-marker` `code-editor-marker-icon` `code-editor-problem` `code-editor-problem-line` `code-editor-problem-message` `code-editor-problems` `code-editor-scroll` `code-editor-text` `code-editor-tooltip` `code-editor-tooltip-line`† `code-token`† `code-token-comment` `code-token-function` `code-token-keyword` `code-token-number` `code-token-property` `code-token-punctuation` `code-token-selector` `code-token-string` | components/code-editor/CodeEditor; components/code-editor/theme |
| `qt-components` | `components`† | components/code-editor/theme +3 |
| `qt-composer` | `composer-narration`† `composer-ooc`† | components/chat/lexical/plugins/PunctuationLintPlugin |
| `qt-confirmation` | `confirmation-badge-label`† | app/salon/[id]/components/message-row/ConfirmationBadge |
| `qt-courier` | `courier-bubble-attachments`† `courier-bubble-paste`† | app/salon/[id]/components/CourierBubble |
| `qt-diagram` | `diagram-lightbox-root`† | components/chat/diagrams/diagram-lightbox-host |
| `qt-doc` | `doc-divider-grip` `doc-editor-with-gutter` `doc-focus-mode` `doc-pane-inner`† `doc-vertical-divider-grip` `doc-vertical-pane-bottom`† `doc-vertical-pane-top`† | app/salon/[id]/components/SplitLayout; app/salon/[id]/components/DocumentPane +1; app/salon/[id]/components/TerminalPane |
| `qt-formatting` | `formatting-toolbar-anchor` | components/chat/FormattingToolbar |
| `qt-help` | `help`† | components/brahma-console/BrahmaConsoleMessageList |
| `qt-inspector` | `inspector-entry` `inspector-entry-highlight` | components/chat/LLMInspectorEntry |
| `qt-inventory` | `inventory-tab`† | components/item-browser/ItemControlDialogShell |
| `qt-lexical` | `lexical-blockquote` `lexical-bold` `lexical-checklist` `lexical-code` `lexical-code-block` `lexical-contenteditable` `lexical-h1` `lexical-h2` `lexical-h3` `lexical-h4` `lexical-h5` `lexical-h6` `lexical-italic` `lexical-li` `lexical-li-checked` `lexical-li-nested` `lexical-li-unchecked` `lexical-link` `lexical-ol` `lexical-paragraph` `lexical-placeholder` `lexical-root` `lexical-strikethrough` `lexical-token`† `lexical-ul` `lexical-underline` | components/chat/lexical/theme; app/salon/[id]/components/DocumentPane +2; components/chat/lexical/LexicalComposerWrapper |
| `qt-memory` | `memory-source-highlight` | app/salon/[id]/hooks/useMessageReveal |
| `qt-mention` | `mention-typeahead-listbox`† | components/chat/lexical/plugins/MentionTypeaheadPlugin |
| `qt-mermaid` | `mermaid`† | components/chat/diagrams/render-mermaid |
| `qt-participant` | `participant-status-select`† | components/chat/ParticipantCard |
| `qt-pretheme` | `pretheme-bg` | components/loading/StartupProgress +2 |
| `qt-punctuation` | `punctuation-no-dialogue`† `punctuation-warning`† | components/chat/lexical/plugins/PunctuationLintPlugin |
| `qt-qtap` | `qtap-doc-icon` | components/qtap/QtapLink |
| `qt-roleplay` | `roleplay-plain`† | components/settings/roleplay-templates/hooks/useRoleplayTemplates +2 |
| `qt-salon` | `salon-portaled-pane` | app/salon/[id]/components/SalonModePanes |
| `qt-speaking` | `speaking-as-avatar`† | app/salon/[id]/components/SpeakingAsAvatar |
| `qt-style` | `style-options-unmarked`† | components/settings/roleplay-templates/index |
| `qt-tab` | `tab-drop-zone-hint` `tab-portal-empty` `tab-portal-host` `tab-portal-mount` | components/workspace/WorkspaceHost; components/workspace/TerminalDocumentViews |
| `qt-template` | `template-char`† `template-user`† | components/markdown-editor/TemplateTokenHighlightPlugin |
| `qt-tooltip` | `tooltip-anchor` | components/ui/Tooltip |
| `qt-typeahead` | `typeahead`† | components/chat/lexical/typeahead/MenuPortal |
| `qt-wardrobe` | `wardrobe-tab`† | components/item-browser/ItemControlDialogShell |

## Names composed from a template literal

Written as `qt-foo${…}` or `qt-foo-${…}`, so they are not in the lists above as whole names. Already hooks: `qt-chat-announcement-chip`, `qt-chat-message-tools`, `qt-chat-desktop-avatar`, `qt-chat-message-action-bar`, `qt-chat-system-bar-expanded`. `qt-green-room` is proposed above; the rest follow the family their prefix belongs to.

`qt-danger-badge` `qt-chat-announcement-dot-outcome` `qt-chat-announcement-dot` `qt-chat-system-bar-chevron` `qt-chat-announcement-chip` `qt-chat-interrupt-button` `qt-green-room` `qt-chat-system-bar-expanded` `qt-chat-message-tools` `qt-doc-split-layout` `qt-chat-desktop-avatar` `qt-chat-message-action-bar` `qt-brahma-launcher` `qt-console-writing-switch` `qt-console-context-chip` `qt-console-output` `qt-concierge-mark` `qt-intervention-section` `qt-formatting-button-emoji` `qt-formatting-button` `qt-formatting-button-code-block` `qt-rp-annotation-button` `qt-code-editor` `qt-code-editor-marker` `qt-code-editor-band` `qt-code-editor-problem` `qt-intervene-toggle` `qt-console-composer` `qt-console-attachment-chip` `qt-style-options` `qt-badge-provider` `qt-token-row`

## Found along the way: classes no stylesheet defines

The markup wrote 12 classes that no CSS anywhere defined, so they did nothing:
`qt-input-sm` (20 uses), `qt-button-danger`, `qt-button-danger-outline`,
`qt-alert-destructive`, `qt-card-content`, `qt-card-selected`, `qt-form-label`,
`qt-callout`, `qt-list-row`, `qt-divider`, `qt-badge-muted`, `qt-accent-primary`
— and `qt-code` (7 uses), which a wider check found afterwards. They were fixed
outside Spec I (`qt-input-sm` defined; the rest swapped for defined classes),
and `scripts/check-qt-classes.mjs` now fails on any bare class in app markup
that is neither defined, catalogued, nor a listed marker. The groups above were
drawn up before the fix and still list these names where they then stood.
