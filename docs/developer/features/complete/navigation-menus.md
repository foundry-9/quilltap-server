# Navigation menus: one registry, a grouped rail and the shell's menu bar

Status: **built** 2026-11-19 (phases 1–3, this repo). Phase 4, the native menu itself, belongs to quilltap-shell. Decided: the rail stays in both the browser and the Electron shell; the shell adds a native menu bar beside it; Scenarios sits under Conversations; Characters is a plain button; the theme picker is always offered. Open decisions are in §11; what the build settled beyond the text is in §12.

The left rail has grown one button at a time to 19 icon-only buttons in two hand-written lists. This spec replaces the lists with one navigation registry, groups the rail into four flyout menus, and gives the Electron shell what it needs to build a native menu bar from the same table, so that "open **Objects** and choose **The Atlas**" is the right instruction everywhere.

---

## 1. What is there now

Two components draw the rail:

- `components/layout/left-sidebar/collapsed-nav.tsx` holds a `navItems` array: Home, Projects, Files, The Scriptorium, Characters, My Photos, Scenarios, Pascal's Workbench, Chats. All are links.
- `components/layout/left-sidebar/sidebar-footer.tsx` hand-writes nine buttons: Help, Brahma Console, Wardrobe, Inventory, The Atlas, Document Mode, Settings, Themes, Quick-hide. `profile-menu.tsx` adds the profile button.

The problems:

1. **The split is an implementation detail.** The top list is "things with a route"; the footer is "things that began as a dialog". So Pascal's Workbench is at the top while Wardrobe, Inventory and the Atlas, which it belongs with, are at the bottom.
2. **Nothing has a visible name.** Each item's name is only a `title` tooltip. Pascal's Workbench and Settings both use a wrench icon.
3. **Nineteen targets do not fit.** On a short window the rail is nearly full, and every new feature adds a button.
4. **The list exists only as JSX.** Nothing outside those two files can enumerate the destinations, so the shell cannot build a menu and help docs describe the rail by hand.
5. **Reachable pages are missing.** Generate Image, the Atelier, the specimen gallery, New Character and the Scenario Builder have tab kinds but no rail entry.

What already works and is kept:

- Every destination is a `TabKind` (`lib/workspace/types.ts`), and `/workspace?open=<kind>` opens any of them (`components/workspace/WorkspaceIntent.tsx`). So every destination already has a working URL, including Wardrobe, Inventory, the Atlas and Brahma.
- `parseHrefToIntent` (`lib/navigation/route-to-intent.ts`) maps a route to a tab intent, and `useWorkspaceLink` opens a tab in place instead of navigating.
- The server knows when the shell spawned it (`isElectronShell`, `QUILLTAP_SHELL_CAPABILITIES` in `lib/paths.ts`), and the page has a `window.quilltap` bridge (`openPath` today).

## 2. Goals and non-goals

**Goals**

- One table lists every navigation item, its group, its label, its icon and its target. The rail, the shell's menu, the theme hook catalogue and help text all read it.
- The rail shows ten buttons or fewer, and every item has a visible text label one click away.
- The group and item names are identical in the rail and the native menu.
- A menu click in the shell opens a tab in place. It never reloads the page.
- Adding a destination is one registry entry and one activator, not a new rail button.

**Non-goals**

- No layout switch between browser and shell. The same rail renders in both.
- No change to the workspace's tabs, panes or toolbar.
- No change to the Settings registry or its deep links.
- No new keyboard accelerators in the first version (§11). The shell's six existing ones carry over.
- No user-customisable rail.

## 3. The registry

`lib/navigation/registry.ts` is pure data: no React, no Node built-ins, safe to import on the client and to serialise as JSON.

```ts
type NavTarget =
  | { type: 'destination'; href: string; tabKind: TabKind }
  | { type: 'action'; action: NavActionId }

interface NavItem {
  id: NavItemId            // written as data-nav; stable, never reused
  label: string            // menu and flyout text
  icon: IconName
  target: NavTarget
  /** Tab kinds this item stands for, for aria-current. Defaults to [target.tabKind]. */
  tabKinds?: readonly TabKind[]
}

interface NavGroup {
  id: NavGroupId
  label: string
  icon: IconName
  items: readonly NavItem[]
}
```

It exports `NAV_TOP` (the two plain buttons, Home and Characters), `NAV_GROUPS` (the four menus) and `NAV_PINNED` (the bottom of the rail), plus `findNavItem(id)` and `navGroupForTabKind(kind)`.

A **destination** is a page: it has an `href` and a `tabKind`. An **action** does something in the page that is not a tab: open the help chat, open the document picker, open the theme picker, toggle the quick-hide panel, open the new-chat modal.

Labels in the registry are user-facing and follow the house voice only where the feature already has a proper name (The Scriptorium, Pascal's Workbench). Group labels are plain nouns.

## 4. The groups

| Group | Items | Target |
|---|---|---|
| **Home** (button, no menu) | — | `/` |
| **Conversations** | Chats | `/salon` |
| | New Chat… | action `new-chat` |
| | Scenarios | `/scenarios` |
| | Brahma Console | `/workspace?open=brahma` |
| **Characters** (button, no menu) | — | `/aurora` |
| **Objects** | Wardrobe | `/workspace?open=wardrobe` |
| | Inventory | `/workspace?open=inventory` |
| | The Atlas | `/workspace?open=atlas` |
| | Pascal's Workbench | `/custom-tools` |
| **Library** | Projects | `/prospero` |
| | Files | `/files` |
| | The Scriptorium | `/scriptorium` |
| | My Photos | `/photos` |
| | Open Document… | action `open-document` |
| **Studio** | Generate Image | `/generate-image` |
| | The Atelier | `/calliope` |
| | Theme Gallery | `/calliope/specimens` |
| | Theme… | action `themes` |
| *Pinned* | Help | action `help` |
| | Quick-hide | action `quick-hide` |
| | Settings | `/settings` |
| | Profile | menu: Profile `/profile`, About `/about` |

The rail goes from 19 buttons to 10: Home, Characters, four groups, and four pinned.

Group icons reuse existing icon names (`chat`, `inventory`, `scriptorium`, `themes`), and Characters keeps `characters`, so no theme needs a new icon override. Pascal's Workbench keeps `wrench` inside its flyout, where it sits beside a label and no longer collides with Settings.

Reasons for the placements that are not obvious:

- **Quick-hide stays one click.** It is a privacy control. Putting it in a menu defeats it.
- **Help and Settings stay pinned.** They are the two things a lost user looks for.
- **Brahma is under Conversations.** It is a conversation surface, and it has a tab.
- **Scenarios is under Conversations** (decided 2026-11-19). A scenario is what a chat starts from, so it sits beside New Chat.
- **Characters is a plain button** (decided 2026-11-19). With Scenarios moved, its menu held only Characters and New Character…, and New Character is already reached from the Characters page. A two-item menu would cost a click on one of the most-visited destinations. Its `aria-current` covers the `aurora`, `character` and `character-new` tab kinds, as now.
- **The theme picker is always offered** (decided 2026-11-19). Theme… is a permanent row in Studio, and the `showNavThemeSelector` setting is retired. It was off by default and existed to save a rail button; a flyout row costs nothing. Retiring it means removing it from the theme preference schema (`lib/schemas/settings.types.ts`), the chat-settings repository default, the profile route's schema and the Appearance card's toggle. It is a key inside stored JSON, not a column, so there is no migration; a stored value or an old backup carrying the key must still parse and is ignored.
- **Pascal's Workbench is under Objects.** Custom tools read and change the Inventory, and the Inventory is Pascal's.

## 5. The rail

`components/layout/left-sidebar/` renders the registry. The two hand-written lists are deleted.

**Group button.** A `<button>` with `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`, an `aria-label` of the group label and a `title` tooltip. It carries `aria-current="page"` when the focused pane's active tab is one of its items' tab kinds, which is how the rail keeps its one active indication.

**Flyout.** Opens on click, to the right of the rail, top-aligned with its button and clamped to the viewport. Pinned menus (quick-hide, profile) open upward as they do now. It contains the group label as a heading and one row per item with its icon and label.

- Click opens and closes. Hover does not: hover menus fail on touch and close when the pointer wanders.
- One flyout is open at a time. Escape, an outside click or choosing an item closes it. Focus returns to the group button.
- `role="menu"` with `role="menuitem"` rows. Up/Down move, Home/End jump, Right from the group button opens it, Left or Escape closes it.
- It portals to `document.body`. `.qt-workspace` is `isolation: isolate`, and a flyout left inside the rail would sit under the workspace toolbar.
- Destination rows stay `<a href>` so middle-click and "open in new tab" work. A plain click goes through `useWorkspaceLink`.
- A disabled row (Help or Brahma with no eligible profile) stays visible with its reason as text under the label, not only as a tooltip.

**Activators.** What a click does is mapped by item id in `components/layout/left-sidebar/activators.ts`, the way `components/settings/cards.tsx` maps a settings card's body. A destination's default activator is "open its tab in the workspace, else navigate to `href`". Three items keep their present chat-aware behaviour as custom activators, moved unchanged from `sidebar-footer.tsx`: outside the workspace, Wardrobe, Inventory and the Atlas open the chat-scoped dialog when the page is a Salon chat.

**Phone width.** The flyout becomes a sheet anchored to the bottom of the screen. The floating Brahma launcher that exists at that width stays.

## 6. The shell's menu bar

The server side is small. The menu itself is built in the quilltap-shell repo. Everything the shell needs (the listing, the preload and main-process wiring, fallbacks, versions and a checklist) is in [navigation-menus-shell-contract.md](navigation-menus-shell-contract.md).

**Listing.** `GET /api/v1/system/navigation` returns the registry:

```json
{
  "version": 1,
  "top": [
    { "id": "home", "label": "Home", "type": "destination", "href": "/" },
    { "id": "characters", "label": "Characters", "type": "destination", "href": "/aurora" }
  ],
  "groups": [
    { "id": "objects", "label": "Objects", "items": [
      { "id": "atlas", "label": "The Atlas", "type": "destination", "href": "/workspace?open=atlas" }
    ] }
  ],
  "pinned": [ { "id": "help", "label": "Help", "type": "action" } ]
}
```

The shell fetches it once the server is up and builds one top-level menu per group, in order. A menu bar cannot hold a plain button, so Home, Characters and the pinned items go under a **Go** menu (or the platform's nearest equivalent). The shell hard-codes no item.

**Activation.** A menu click sends the item **id** to the page, not a URL:

- The page registers a handler through the bridge: `window.quilltap.onNavigate?.((id) => activate(id))`. The shell's preload script supplies `onNavigate`; the server repo declares its type beside `openPath`.
- The handler runs the same activator a rail click runs. So a native menu click and a rail click cannot behave differently.
- If the page has not registered a handler (still starting, or on the unlock screen), the shell falls back to loading the item's `href` for a destination and does nothing for an action.

Loading a URL is only the fallback because a real navigation unmounts the workspace, which ends a streaming Salon turn.

**Capability.** The shell advertises `NATIVE_NAV_MENU` in `QUILLTAP_SHELL_CAPABILITIES`. Nothing in the server branches on it in this version; it is there so a later "hide the rail in the shell" setting has something to read.

**Versions.** An older shell ignores the endpoint and keeps its own hard-coded Navigate menu. A newer shell against an older server gets a 404 and keeps that same legacy Navigate menu (decided 2026-11-19, after reading the shell; see the contract §6). Neither breaks.

## 7. Theme hooks

The rail's hooks are catalogued in `lib/themes/hooks/sidebar.ts`, and a hook needs a specimen.

- `SIDEBAR_NAV_IDS` and `SIDEBAR_ACTION_IDS` are derived from the registry instead of hand-listed. Every existing `data-nav` value survives on its item, now on a flyout row. Four group ids are added.
- New hooks: the group button, the flyout, its heading, a flyout row and a row's disabled reason. `qt-left-sidebar-popout`, which the theme and quick-hide menus already use, is the flyout's class, so a theme that styles the popout styles the flyout.
- `qt-collapsed-nav-button` stays as the class on Home and the group buttons.
- Each new hook gets an entry in `components/theme-specimens/specimens/shell.tsx`.
- No bundled theme or app stylesheet selects on `data-nav` today (checked 2026-11-19), so no bundled theme needs repair. An installed third-party theme that styles one rail button by `data-nav` will find that item in a flyout; this goes in the changelog.
- After the CSS changes: `npm run generate:theme-styled-by`.

## 8. Help and instructions

- A help page, `help/navigation.md`, describes the rail, the four groups and the shell's menus. It is generated from, or tested against, the registry (§9).
- Help docs that say where a button is (about twenty mention the sidebar) are rewritten to the form "open **Group** and choose **Item**".
- The help-chat character's navigation guidance uses the same phrasing. `help_navigate` URLs do not change.

## 9. Tests

- **Registry:** ids are unique; every destination's `href` resolves through `parseHrefToIntent` or the `?open=` allow-list to its declared `tabKind`; every action id has an activator; every item id has a `data-nav` hook value.
- **Single source:** a grep-test fails if a file outside `lib/navigation/` and the rail's activators declares a list of rail destinations.
- **Help:** every "open **X** and choose **Y**" in `help/*.md` names a group and item that exist, the way `settings-links.test.ts` holds settings links to the settings registry.
- **Rail:** keyboard movement, Escape and focus return, one flyout at a time, `aria-current` on the right group, disabled rows.
- **Endpoint:** the JSON matches the registry and carries no icon or activator detail.
- **Specimen coverage** picks up the new hooks without change.

## 10. Phases

1. **Registry.** Add `lib/navigation/registry.ts` and the activators; make the existing rail render from it with no visible change. Derive the hook id lists. Tests for the registry.
2. **Grouped rail.** Group buttons, flyouts, hooks, specimens, phone-width sheet. Retire `showNavThemeSelector`. Help page and the help-doc sweep. Changelog.
3. **Endpoint and bridge.** `GET /api/v1/system/navigation`, the `onNavigate` type and handler. API.md.
4. **Shell.** Native menu in quilltap-shell, built from the endpoint. Separate repo, separate release.

Phase 1 is a refactor that can ship alone. Phases 2 and 3 are independent of each other. Phase 4 needs phase 3.

## 11. Open decisions

1. **Accelerators.** Cmd/Ctrl+1 to 4 for the groups would suit the native menu, but they must not collide with the workspace's tab shortcuts or the composer. Left out of the first version. The shell's six existing accelerators carry over, keyed by item id (§12).
2. **Hiding the rail in the shell.** Decided against for now. If wanted later, it is an Appearance setting read with the `NATIVE_NAV_MENU` capability.
3. **The Studio name.** "Studio" is a plain word that does not clash with a persona. "Atelier" is already the theme editor's name, so it cannot be the group's.

## 12. As built

- **Files.** Registry `lib/navigation/registry.ts` (`NAV_TOP`, `NAV_GROUPS`, `NAV_PINNED`, and `NAV_PROFILE` for the profile button's menu); the shell's listing `lib/navigation/listing.ts`; activators `components/layout/left-sidebar/activators.ts` (`ACTION_ACTIVATORS` is a full record over `NAV_ACTION_IDS`, `DESTINATION_ACTIVATORS` the overrides); rail state, `activate(id)` and the `onNavigate` registration in `nav-rail-context.tsx`; the flyout in `nav-flyout.tsx`.
- **Item ids.** Every old `data-nav` value survives; Open Document… keeps `document-mode` and Theme… keeps `themes`. New ids: `new-chat`, `generate-image`, `atelier`, `theme-gallery`, `profile`, `about`; group ids `conversations`, `objects`, `library`, `studio`; the profile button is `profile-menu`.
- **Brahma** keeps its floating-console dialog outside the workspace, as Wardrobe, Inventory and the Atlas keep theirs. Inside the workspace all four open tabs.
- **Panels.** Theme… and Quick-hide open a panel (`role="dialog"`) in the same flyout slot, so one flyout is open at a time across menus and panels. Theme… hangs from the Studio button.
- **Hooks.** `HOOK_CATALOGUE_VERSION` is 2: `qt-collapsed-nav-button` and `qt-left-sidebar-item` lost the values that moved into flyouts. New hooks `qt-left-sidebar-menu-heading`, `-menu`, `-menu-item`, `-menu-item-icon`, `-menu-item-text`, `-menu-item-label`, `-menu-item-reason`; `qt-left-sidebar-popout` gained `data-nav-menu` and the `qt-left-sidebar-popout-sheet` state.
- **Settings** carries `aria-current` like the group buttons.
- **Help.** `help/sidebar.md` became `help/navigation.md`; `__tests__/unit/help/navigation-phrases.test.ts` holds every "open **X** and choose **Y**" to the registry.
- **Tests.** `__tests__/unit/lib/navigation/` (registry, single source), `__tests__/unit/components/layout/left-sidebar.test.tsx`, `__tests__/unit/app/api/v1/system/navigation/route.test.ts`.
- **The shell's contract** is a separate page, [navigation-menus-shell-contract.md](navigation-menus-shell-contract.md). Writing it against quilltap-shell 4.2.6 settled two things this spec had left open or got wrong. The shell already ships a hard-coded **Navigate** menu that reloads the page, so **Go** and the four groups replace it in place (between Edit and View), and it stays as the fallback when the listing is unavailable. It also has six accelerators (⇧⌘H, ⇧⌘P, ⇧⌘F, ⇧⌘C, ⇧⌘S, ⌘,), so they carry over, keyed by item id. §11.1 now concerns only adding new ones.
