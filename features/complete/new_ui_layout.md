# Feature: New UI Layout

**Status: Implemented** (2025-12-31)

In preparation for projects and files, we needed a new layout for the desktop UI.

## Features of the new layout

- No more dashboard (redirects to home page)
- Left sidebar with tree views, always visible, contents might change with context but not yet
  - Button to push to fold sidebar in and out (collapsed state persisted to localStorage)
  - Projects (placeholder - "Coming soon")
  - Files (placeholder - "Coming soon")
  - Characters (favorites and top-conversation-participants at the top, ends with a link to Characters page)
  - Chats (most recent to less recent, flex-fills screen, at the bottom of the list is a link to Chats page)
  - (At the bottom after Chats list) Settings button - takes you to settings
  - Tools button - takes you to tools
  - Themes button - links to appearance settings if theme selector is enabled
  - Quick-hide button - links to appearance settings if quick-hide tags exist
  - Profile menu - your avatar, your username/email address, links to profile page, dev console if available, sign out button
- Header
  - Quilltap logo with link built-in to home page
  - Centered search bar
  - Auto-widen full-screen toggle button
  - Hamburger menu on mobile to open sidebar overlay
- Footer (same as before)
- Mobile: sidebar is an overlay drawer from the left

## Implementation

### New Components

- `components/layout/app-layout.tsx` - Root layout wrapper
- `components/layout/app-header.tsx` - Simplified header
- `components/layout/left-sidebar/` - Sidebar components
  - `index.tsx` - Main sidebar
  - `sidebar-header.tsx` - Collapse toggle
  - `sidebar-section.tsx` - Section container
  - `sidebar-item.tsx` - Navigation item
  - `sidebar-footer.tsx` - Footer with actions
  - `characters-section.tsx` - Characters list
  - `chats-section.tsx` - Chats list
  - `profile-menu.tsx` - User profile dropdown
- `components/providers/sidebar-provider.tsx` - Sidebar state management

### New API Endpoints

- `GET /api/sidebar/characters` - Fetches favorite characters and top participants
- `GET /api/sidebar/chats` - Fetches recent chats

### CSS Classes (in `app/styles/qt-components/`)

- `_variables.css` - Added `--qt-left-sidebar-*` and `--qt-app-header-*` variables
- `_layout.css` - Added `.qt-left-sidebar-*`, `.qt-app-layout`, `.qt-app-header-*`, `.qt-hamburger` classes

### Modified Files

- `app/layout.tsx` - Uses AppLayout instead of NavWrapper
- `app/page.tsx` - New authenticated home page with welcome, favorites, and "Start Chat" button
- `app/dashboard/page.tsx` - Redirects to home page
