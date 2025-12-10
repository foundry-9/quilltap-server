# qt-* Semantic Component Class System - Migration Plan

## Overview

This document tracks the ongoing migration from hardcoded Tailwind utility classes to semantic `qt-*` classes. The goal is to make theming easier by providing consistent, themeable component styling that theme plugins can override via `[data-theme="name"]` selectors or CSS variables.

## Completed Work

### Phase 1: Foundation (Complete)

- Created CSS infrastructure in `app/styles/qt-components/`
- Core files: `_index.css`, `_variables.css`, `_interactive.css`, `_surfaces.css`, `_layout.css`, `_content.css`, `_chat.css`
- Established naming convention: `qt-{component}[-{variant}][-{modifier}]`

### Phase 2: Layout Components (Complete)

- Migrated `components/dashboard/nav.tsx` - `qt-navbar-*` classes
- Migrated `components/dashboard/dashboard-cards.tsx` - `qt-card` classes

### Phase 3: Chat Components (Complete)

- Migrated `components/chat/ParticipantCard.tsx` - `qt-participant-card-*` classes
- Migrated `components/chat/MessageContent.tsx` - `qt-code-inline`, `qt-link`, `qt-chat-message-content`
- Migrated `app/(authenticated)/chats/[id]/page.tsx` - `qt-chat-message-*`, `qt-textarea`, `qt-button-*`, `qt-code-block`, `qt-chat-composer-*`

### Phase 4: Content Components (Complete)

- Added `qt-tag-badge-*` classes to `_content.css`
- Migrated `components/tags/tag-badge.tsx`
- Enhanced `_surfaces.css` dialog classes
- Migrated `components/images/avatar-selector.tsx`

### Footer Migration (Complete)

- Added `qt-footer-*` classes to `_layout.css`
- Added footer variables to `_variables.css`
- Migrated `components/footer-wrapper.tsx`

### Auth/Splash Pages (Complete)

- Added `qt-auth-*` classes to `_layout.css`
- Added `qt-alert-*` classes to `_content.css`
- Added auth variables to `_variables.css`
- Migrated:
  - `app/page.tsx` (splash page)
  - `app/auth/signin/page.tsx`
  - `app/auth/signup/page.tsx`
  - `app/auth/error/page.tsx`

---

## Remaining Migration Work

### Phase 5: Core Dialogs

**Priority: High** - These are reusable components used throughout the app.

| File | Current State | Migration Needs |
|------|--------------|-----------------|
| `components/alert-dialog.tsx` | Hardcoded overlay, modal, buttons | `qt-dialog-overlay`, `qt-dialog`, `qt-dialog-header`, `qt-dialog-body`, `qt-dialog-footer`, `qt-button-*` |
| `components/character-delete-dialog.tsx` | Hardcoded dialog + warning alert | `qt-dialog-*`, `qt-alert-warning`, `qt-button-*` |
| `lib/alert.tsx` | Hardcoded alert utility | `qt-dialog-*` classes |

### Phase 6: Image Dialogs

**Priority: High** - Frequently used image management components.

| File | Current State | Migration Needs |
|------|--------------|-----------------|
| `components/images/image-generation-dialog.tsx` | Hardcoded modal | `qt-dialog-*`, `qt-input`, `qt-button-*` |
| `components/images/image-upload-dialog.tsx` | Hardcoded modal | `qt-dialog-*`, `qt-input`, `qt-button-*` |
| `components/images/ImageDetailModal.tsx` | Hardcoded modal | `qt-dialog-*`, `qt-input`, `qt-button-*` |
| `components/images/EmbeddedPhotoGallery.tsx` | Hardcoded gallery modal | `qt-dialog-*`, `qt-button-*` |
| `components/images/PhotoGalleryModal.tsx` | Hardcoded gallery | `qt-dialog-*` |
| `components/images/image-gallery.tsx` | Hardcoded grid | `qt-card` for image items |

### Phase 7: Chat Dialogs

**Priority: Medium** - Chat-specific modal components.

| File | Current State | Migration Needs |
|------|--------------|-----------------|
| `components/chat/AddCharacterDialog.tsx` | Hardcoded modal | `qt-dialog-*`, `qt-button-*` |
| `components/chat/ChatGalleryImageViewModal.tsx` | Hardcoded image viewer | `qt-dialog-*` |
| `components/chat/ChatSettingsModal.tsx` | Hardcoded settings modal | `qt-dialog-*`, `qt-input`, `qt-button-*` |
| `components/chat/GenerateImageDialog.tsx` | Hardcoded generation dialog | `qt-dialog-*`, `qt-button-*` |
| `components/chat/ImageModal.tsx` | Hardcoded image modal | `qt-dialog-*` |
| `components/chat/ToolMessage.tsx` | Hardcoded tool alerts | `qt-alert-*`, `qt-button-*` |
| `components/chat/ToolPalette.tsx` | Hardcoded tool buttons | `qt-button-*` |

### Phase 8: Memory & Import Dialogs

**Priority: Medium**

| File | Current State | Migration Needs |
|------|--------------|-----------------|
| `components/memory/housekeeping-dialog.tsx` | Hardcoded dialog | `qt-dialog-*`, `qt-button-*` |
| `components/memory/memory-editor.tsx` | Hardcoded editor modal | `qt-dialog-*`, `qt-input`, `qt-textarea` |
| `components/import/import-wizard.tsx` | Hardcoded wizard modal | `qt-dialog-*`, `qt-button-*` |
| `components/import/memory-creation-dialog.tsx` | Hardcoded dialog | `qt-dialog-*`, `qt-button-*` |

### Phase 9: Tools & Settings Dialogs

**Priority: Medium**

| File | Current State | Migration Needs |
|------|--------------|-----------------|
| `components/tools/backup-dialog.tsx` | Hardcoded dialog | `qt-dialog-*`, `qt-button-*` |
| `components/tools/restore-dialog.tsx` | Hardcoded dialog | `qt-dialog-*`, `qt-button-*` |
| `components/search/search-dialog.tsx` | Hardcoded search modal | `qt-dialog-*`, `qt-input` |
| `components/physical-descriptions/physical-description-editor.tsx` | Hardcoded editor | `qt-dialog-*`, `qt-textarea` |

### Phase 10: Form Pages

**Priority: Medium** - Pages with many form inputs.

| File | Current State | Migration Needs |
|------|--------------|-----------------|
| `app/(authenticated)/characters/new/page.tsx` | 18+ hardcoded inputs, error messages | `qt-input`, `qt-textarea`, `qt-select`, `qt-alert-error`, `qt-button-*`, `qt-link` |
| `components/settings/api-keys-tab.tsx` | Hardcoded inputs | `qt-input`, `qt-button-*` |
| `components/settings/chat-settings-tab.tsx` | Hardcoded inputs | `qt-input`, `qt-select` |
| `components/settings/connection-profiles-tab.tsx` | Hardcoded inputs | `qt-input`, `qt-button-*` |
| `components/settings/embedding-profiles-tab.tsx` | Hardcoded inputs | `qt-input`, `qt-select` |
| `components/settings/model-selector.tsx` | Hardcoded select | `qt-select` |
| `components/image-profiles/ImageProfileForm.tsx` | Hardcoded form | `qt-input`, `qt-select`, `qt-button-*` |
| `components/image-profiles/ImageProfileParameters.tsx` | Hardcoded parameters | `qt-input` |

### Phase 11: Cards & Lists

**Priority: Low** - Content display components.

| File | Current State | Migration Needs |
|------|--------------|-----------------|
| `components/dashboard/recent-chats.tsx` | Hardcoded card styling | `qt-card`, `qt-card-interactive` |
| `components/memory/memory-card.tsx` | Hardcoded card | `qt-card` |
| `components/physical-descriptions/physical-description-card.tsx` | Hardcoded card | `qt-card`, `qt-button-*` |
| `components/physical-descriptions/physical-description-list.tsx` | Hardcoded list | `qt-card` |
| `components/tools/backup-restore-card.tsx` | Hardcoded card | `qt-card` |

### Phase 12: Badges & Labels

**Priority: Low** - Small UI elements.

| File | Current State | Migration Needs |
|------|--------------|-----------------|
| `components/search/search-results.tsx` | Purple/blue/green badges | `qt-badge-*` variants |
| `components/settings/plugins-tab.tsx` | Plugin source badges | `qt-badge-*` variants |
| `components/dashboard/recent-chats.tsx` | Message count badge | `qt-badge-*` |
| `components/image-profiles/ImageProfilePicker.tsx` | Selection badges | `qt-badge-*` |
| `components/characters/TemplateHighlighter.tsx` | Template badges | `qt-badge-*` |

### Phase 13: Debug Components

**Priority: Low** - Developer-facing components.

| File | Current State | Migration Needs |
|------|--------------|-----------------|
| `components/debug/BrowserConsoleTab.tsx` | Hardcoded styling | `qt-button-*`, `qt-alert-*` |
| `components/debug/DebugPanel.tsx` | Hardcoded panel | `qt-panel`, `qt-button-*` |
| `components/debug/DevConsolePanel.tsx` | Hardcoded console | `qt-panel`, `qt-button-*` |
| `components/debug/ServerLogsTab.tsx` | Hardcoded log styling | `qt-button-*`, `qt-alert-*` |

### Phase 14: Navigation Cleanup

**Priority: Low** - Remaining nav elements.

| File | Current State | Migration Needs |
|------|--------------|-----------------|
| `components/dashboard/nav.tsx` | Sign out button, DevConsole toggle, quick-hide buttons still hardcoded | `qt-button-*`, `qt-navbar-button` cleanup |

---

## New CSS Classes Needed

### Semantic Badge Variants (for Phase 12)

Based on actual usage in the codebase, colors are associated with specific entity types:

| Color | Entity | Used For |
|-------|--------|----------|
| Purple | Characters | Character badges, "Related" indicator, manual memories |
| Green | Personas | Persona badges, enabled status |
| Blue | Chats | Chat badges, matched tags, plugin capabilities |
| Orange | Tags | Tag badges, Git plugin source |
| Pink | Memories | Memory badges |
| Red | Errors/NPM | NPM plugin source, error counts |

Add to `_content.css`:

```css
/* Entity-type badges - semantic naming with default colors */
.qt-badge-character {
  @apply bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400;
}
.qt-badge-persona {
  @apply bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400;
}
.qt-badge-chat {
  @apply bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400;
}
.qt-badge-tag {
  @apply bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400;
}
.qt-badge-memory {
  @apply bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400;
}

/* Status badges */
.qt-badge-enabled {
  @apply bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400;
}
.qt-badge-disabled {
  @apply bg-muted text-muted-foreground;
}
.qt-badge-related {
  @apply bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400;
}
.qt-badge-manual {
  @apply bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400;
}
.qt-badge-auto {
  @apply bg-muted text-muted-foreground;
}

/* Plugin source badges */
.qt-badge-source-included {
  @apply bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400;
}
.qt-badge-source-npm {
  @apply bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400;
}
.qt-badge-source-git {
  @apply bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400;
}
.qt-badge-source-manual {
  @apply bg-muted text-muted-foreground;
}

/* Capability badges */
.qt-badge-capability {
  @apply bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400;
}

/* Version badge */
.qt-badge-version {
  @apply bg-muted text-muted-foreground;
}
```

This allows theme authors to override all character-related badges with a single selector, etc.

### Form Label (standardize across all forms)

Consider adding to `_interactive.css`:

```css
.qt-label {
  @apply block text-sm font-medium;
  color: var(--qt-label-fg, var(--color-foreground));
}
.qt-hint {
  @apply mt-1 text-xs;
  color: var(--qt-hint-fg, var(--color-muted-foreground));
}
```

### New Semantic Hooks (2024-XX)

- Added status token variables `--qt-status-success-*`, `--qt-status-warning-*`, `--qt-status-info-*`, and `--qt-status-danger-*` plus chat/composer knobs (`--qt-chat-toolbar-*`, `--qt-chat-attachment-*`, `--qt-chat-sidebar-*`, `--qt-chat-composer-padding-*`). Themes should override these variables instead of Tailwind utilities when restyling badges, alerts, or chat controls.
- Introduced chat layout classes `.qt-chat-layout`, `.qt-chat-main`, `.qt-chat-message-row`, `.qt-chat-message-body`, `.qt-chat-attachment-list`, `.qt-chat-toolbar`, `.qt-chat-toolbar-button`, `.qt-chat-continue-button`, `.qt-chat-sidebar-*`, and `.qt-chat-attachment-chip*`. Chat pages now consume these semantics end-to-end.
- Expanded navbar helpers with `.qt-navbar-toggle`, `.qt-navbar-toggle-active`, `.qt-navbar-dropdown`, `.qt-navbar-dropdown-item`, `.qt-navbar-chip-button`, and related helpers so quick-hide controls, dropdowns, and icon buttons inherit theme styling automatically.

---

## Key Patterns to Replace

When migrating files, replace these common patterns:

| Hardcoded Pattern | Replace With |
|-------------------|--------------|
| `bg-white dark:bg-slate-800` | `bg-card` or `qt-card` |
| `border border-gray-300 dark:border-slate-600` | `border-border` + `qt-input` |
| `text-gray-900 dark:text-white` | `text-foreground` |
| `text-gray-500 dark:text-gray-400` | `text-muted-foreground` |
| `bg-red-100 dark:bg-red-900/30 text-red-700` | `qt-alert-error` |
| `bg-amber-50 border-amber-200` | `qt-alert-warning` |
| `bg-green-50 border-green-200` | `qt-alert-success` |
| `fixed inset-0 bg-black bg-opacity-50` | `qt-dialog-overlay` |
| `rounded-lg p-6 shadow-xl` (modal) | `qt-dialog` |
| `px-4 py-2 bg-blue-600 text-white` | `qt-button-primary` |
| `px-4 py-2 bg-gray-200 text-gray-700` | `qt-button-secondary` |
| `px-4 py-2 bg-red-600 text-white` | `qt-button-destructive` |

---

## Theme Plugin Migration (Phase 15)

After component migration is complete, update theme plugins to use `qt-*` overrides:

| Theme Plugin | File | Status |
|--------------|------|--------|
| Rains | `plugins/dist/qtap-plugin-theme-rains/styles.css` | Pending |
| Ocean | `plugins/dist/qtap-plugin-theme-ocean/styles.css` | Pending |
| Earl Grey | `plugins/dist/qtap-plugin-theme-earl-grey/styles.css` | Pending |

Example theme override pattern:

```css
[data-theme="rains"] {
  /* Variable overrides */
  --qt-button-radius: 1rem;
  --qt-card-shadow: 0 45px 120px -70px hsl(var(--always-black) / 0.9);
  --qt-auth-page-bg: linear-gradient(135deg, var(--color-background), var(--color-muted));
}

[data-theme="rains"] .qt-button-primary {
  /* Direct class overrides */
  background: linear-gradient(135deg, hsl(var(--accent-brand)), hsl(var(--accent-main-000)));
}
```

---

## Progress Tracking

| Phase | Status | Files | Notes |
|-------|--------|-------|-------|
| 1. Foundation | Complete | 6 CSS files | Core infrastructure |
| 2. Layout | Complete | 2 files | Nav, dashboard cards |
| 3. Chat | Complete | 3 files | Chat page, ParticipantCard, MessageContent |
| 4. Content | Complete | 4 files | Tags, avatar selector, surfaces |
| Footer | Complete | 3 files | Footer wrapper, layout, variables |
| Auth/Splash | Complete | 7 files | Auth pages, splash, alerts |
| 5. Core Dialogs | Complete | 3 files | alert-dialog, character-delete-dialog, lib/alert |
| 6. Image Dialogs | Complete | 6 files | All image dialogs migrated |
| 7. Chat Dialogs | Complete | 7 files | All chat dialogs migrated |
| 8. Memory/Import | Complete | 4 files | All memory/import dialogs migrated |
| 9. Tools/Settings | Complete | 4 files | backup, restore, search, physical-description-editor |
| 10. Form Pages | Complete | 8 files | All form pages and settings tabs |
| 11. Cards/Lists | Complete | 5 files | recent-chats, memory-card, physical-descriptions, backup-restore |
| 12. Badges | Complete | 5 files | Entity-type badges added to CSS, components migrated |
| 13. Debug | Complete | 4 files | All debug components migrated |
| 14. Nav Cleanup | Complete | 1 file | Remaining nav buttons migrated |
| 15. Theme Plugins | Complete | 3 files | Rains, Ocean, Earl Grey themes updated |

---

## Commits Made

1. `2fe59a1` - feat: Migrate chat components to qt-* semantic classes (Phase 3)
2. `8c7da8c` - feat: Migrate content components to qt-* semantic classes (Phase 4)
3. `a1e18fa` - feat: Migrate footer to qt-* semantic classes
4. `5d1c78c` - feat: Migrate splash and auth pages to qt-* semantic classes
5. `7edc82d` - feat: Migrate chat dialogs to qt-* semantic classes (Phase 7)

---

## Migration Complete

All phases of the qt-* semantic class migration have been completed. The codebase now uses:

- **Semantic dialog classes**: `qt-dialog-*` for overlays, containers, headers, bodies, footers
- **Semantic button classes**: `qt-button-primary`, `qt-button-secondary`, `qt-button-ghost`, `qt-button-destructive`, `qt-button-icon`
- **Semantic input classes**: `qt-input`, `qt-textarea`, `qt-select`
- **Semantic card classes**: `qt-card`, `qt-card-interactive`
- **Semantic alert classes**: `qt-alert-success`, `qt-alert-warning`, `qt-alert-error`, `qt-alert-info`
- **Entity-type badge classes**: `qt-badge-character`, `qt-badge-persona`, `qt-badge-chat`, `qt-badge-tag`, `qt-badge-memory`
- **Status badge classes**: `qt-badge-enabled`, `qt-badge-disabled`, `qt-badge-related`, `qt-badge-manual`, `qt-badge-auto`
- **Plugin source badges**: `qt-badge-source-included`, `qt-badge-source-npm`, `qt-badge-source-git`, `qt-badge-source-manual`
- **Utility badges**: `qt-badge-capability`, `qt-badge-version`
- **Form label classes**: `qt-label`, `qt-hint`

Theme plugins (Rains, Ocean, Earl Grey) have been updated with qt-* variable overrides to leverage the new semantic system.
