# Navigation menus: the shell's contract

Status: **server side built** 2026-11-19 (quilltap-server 4.14-dev); the shell side shipped in quilltap-shell 4.2.7. This page is for whoever builds the native menu bar in [quilltap-shell](https://github.com/foundry-9/quilltap-shell). It says what the server provides, what the shell must supply, and how the two behave together. Read it on its own; it does not depend on the server's code. Why the menus are shaped this way is in [navigation-menus.md](navigation-menus.md) (§6 is the summary this page expands). File references to the shell are to quilltap-shell 4.2.6 (`372feb5`).

---

## 0. What the shell does today, and what changes

`buildAppMenu(win)` in `electron/main.ts` builds the menu bar when `createMainWindow` makes the main window. Its menus are: the app menu (macOS), **File**, **Edit**, **Navigate**, **View**, **Window** and **Help**. **Navigate** is a hard-coded list of eight items: Home, Projects, Files, Characters, Chats, Settings, Profile and About. Each click calls `win.webContents.loadURL(appOrigin + path)`.

That reload is the problem this work solves. A page load unmounts the workspace, so choosing **Navigate → Files** while a Salon reply is streaming ends the reply and drops every open tab's in-memory state. The listing also misses most of the app: the Atlas, the Wardrobe, Brahma, the Atelier and others are not in it.

The change, in short:

1. Fetch the server's navigation listing (§2).
2. Replace **Navigate** with a **Go** menu and the four group menus, built from the listing (§1).
3. Send a clicked item's **id** to the page through a new preload method, `onNavigate` (§4). Fall back to `loadURL` only when the page has not registered.
4. Keep today's **Navigate** menu, unchanged, as the fallback for a server that has no listing (§6).
5. Add `NATIVE_NAV_MENU` to `SHELL_CAPABILITIES` (§7).

Everything else in the menu bar stays as it is: the app menu, File, Edit, View, Window, Help, **Restart Server** and **Change Site...**.

## 1. What the shell builds

One native menu per navigation group, in the order the server lists them, plus a **Go** menu for the items that are plain buttons on the rail. They take the place **Navigate** has now. On macOS:

```
Quilltap  File  Edit  Go  Conversations  Objects  Library  Studio  View  Window  Help
```

- **Go** and the four groups go exactly where **Navigate** sits today, between Edit and View. Windows and Linux use the same order, without the app menu.
- **Go** holds `top`, a separator, then `pinned`, in the order listed (§3).
- Each group menu holds that group's `items`, in the order listed.
- Every label comes from the server, character for character, including "The" and the ellipsis in `New Chat…`, `Open Document…` and `Theme…`. Do not translate, shorten or retitle labels. The help pages tell users to "open **Objects** and choose **The Atlas**", and a test holds those words to the same table.
- **Hard-code no item.** Everything in these menus comes from the listing. A new destination added on the server appears in the shell without a shell release.
- Leave the shell's own **Help** menu (if it has one) alone. The server's Help item lives under **Go**, because it opens the in-app help chat rather than documentation.
- **Accelerators: keep the six there are now, keyed by item id, and add none.** Attach each one only when the listing has that id:

  | Id | Accelerator (today's) |
  |---|---|
  | `home` | `CmdOrCtrl+Shift+H` |
  | `projects` | `CmdOrCtrl+Shift+P` |
  | `files` | `CmdOrCtrl+Shift+F` |
  | `characters` | `CmdOrCtrl+Shift+C` |
  | `chats` | `CmdOrCtrl+Shift+S` |
  | `settings` | `CmdOrCtrl+,` |

  Operators already rely on these, so dropping them would be a regression. None collides with the page: the workspace's tab shortcuts are Cmd/Ctrl+Alt+arrows and search is Cmd/Ctrl+K. Don't add new ones, such as Cmd/Ctrl+1–4 for the groups. Accelerators beyond these six are an open decision on the server side (spec §11.1).

  This map is the one item-specific table the shell may keep. It only decorates items the listing provides; it never adds an item.
- Menu items are never disabled or checked in version 1 (§5.3).

## 2. Fetching the listing

```
GET {serverBaseUrl}/api/v1/system/navigation
```

- **No authentication.** The listing is static and holds no user data, so the route needs no session, and it answers while the instance is locked.
- **Origin.** Fetch from the main process (Node `fetch` or `net.request`). The server's origin gate refuses unknown `Host` names and cross-site browser requests. A request with no `Origin` or `Sec-Fetch-Site` header counts as a non-browser client and is allowed, and a main-process request sends neither. The `Host` must be one the server answers to; the loopback address the shell already uses is one.
- **When.** In `buildAppMenu`, which runs as `createMainWindow` makes the window, once the shell's `HealthChecker` has found `/api/health` healthy. Build the menu bar straight away with the legacy **Navigate** menu, fetch the listing without blocking the window, and rebuild the menu bar when the listing arrives (§6). A server restart or **Change Site...** makes a new main window, so the listing is fetched again then; a different server version may serve a different listing. Don't poll it otherwise; it changes only between server versions.
- **Every runtime mode.** Fetch from `serverBaseUrl()`, whichever mode the shell is in: the embedded server, Docker, a remote server or the dev server. A remote server may be any version, so §6 matters most there.
- **Response:** `200 OK`, `Content-Type: application/json`, body as in §3.

## 3. The listing

```json
{
  "version": 1,
  "top": [
    { "id": "home", "label": "Home", "type": "destination", "href": "/" },
    { "id": "characters", "label": "Characters", "type": "destination", "href": "/aurora" }
  ],
  "groups": [
    {
      "id": "conversations",
      "label": "Conversations",
      "items": [
        { "id": "chats", "label": "Chats", "type": "destination", "href": "/salon" },
        { "id": "new-chat", "label": "New Chat…", "type": "action" },
        { "id": "scenarios", "label": "Scenarios", "type": "destination", "href": "/scenarios" },
        { "id": "brahma", "label": "Brahma Console", "type": "destination", "href": "/workspace?open=brahma" }
      ]
    },
    {
      "id": "objects",
      "label": "Objects",
      "items": [
        { "id": "wardrobe", "label": "Wardrobe", "type": "destination", "href": "/workspace?open=wardrobe" },
        { "id": "inventory", "label": "Inventory", "type": "destination", "href": "/workspace?open=inventory" },
        { "id": "atlas", "label": "The Atlas", "type": "destination", "href": "/workspace?open=atlas" },
        { "id": "custom-tools", "label": "Pascal's Workbench", "type": "destination", "href": "/custom-tools" }
      ]
    },
    {
      "id": "library",
      "label": "Library",
      "items": [
        { "id": "projects", "label": "Projects", "type": "destination", "href": "/prospero" },
        { "id": "files", "label": "Files", "type": "destination", "href": "/files" },
        { "id": "scriptorium", "label": "The Scriptorium", "type": "destination", "href": "/scriptorium" },
        { "id": "photos", "label": "My Photos", "type": "destination", "href": "/photos" },
        { "id": "document-mode", "label": "Open Document…", "type": "action" }
      ]
    },
    {
      "id": "studio",
      "label": "Studio",
      "items": [
        { "id": "generate-image", "label": "Generate Image", "type": "destination", "href": "/generate-image" },
        { "id": "atelier", "label": "The Atelier", "type": "destination", "href": "/calliope" },
        { "id": "theme-gallery", "label": "Theme Gallery", "type": "destination", "href": "/calliope/specimens" },
        { "id": "themes", "label": "Theme…", "type": "action" }
      ]
    }
  ],
  "pinned": [
    { "id": "help", "label": "Help", "type": "action" },
    { "id": "quick-hide", "label": "Quick-hide", "type": "action" },
    { "id": "settings", "label": "Settings", "type": "destination", "href": "/settings" },
    { "id": "profile", "label": "Profile", "type": "destination", "href": "/profile" },
    { "id": "about", "label": "About", "type": "destination", "href": "/about" }
  ]
}
```

This is version 1 as served today. The table may grow, so build from the response, not from this example.

### Fields

| Field | Type | Meaning |
|---|---|---|
| `version` | integer | The listing's format. `1` today (§6). |
| `top` | item[] | The rail's plain buttons at the top. Goes in **Go**, before the separator. |
| `groups` | group[] | The four menus, in order. |
| `groups[].id` | string | Stable group id: `conversations`, `objects`, `library`, `studio`. |
| `groups[].label` | string | The menu's title. |
| `groups[].items` | item[] | The menu's rows, in order. |
| `pinned` | item[] | The rail's pinned buttons, then the profile menu's rows. Goes in **Go**, after the separator. |
| `item.id` | string | Stable item id. **This is what the shell sends back** (§4). Never reused, never renamed. |
| `item.label` | string | The row's text. |
| `item.type` | `"destination"` \| `"action"` | A page, or something done in the page that is not a page. |
| `item.href` | string | Destinations only: a path relative to the server's origin. Used only as the fallback (§4.3). |

The listing has no icons, tab kinds or enablement. Menu rows are text only.

The same shapes as TypeScript, for `electron/types.ts`. They match `lib/navigation/listing.ts` on the server.

```ts
export type NavigationListingItem =
  | { id: string; label: string; type: 'destination'; href: string }
  | { id: string; label: string; type: 'action' }

export interface NavigationListing {
  version: number
  top: NavigationListingItem[]
  groups: { id: string; label: string; items: NavigationListingItem[] }[]
  pinned: NavigationListingItem[]
}

/** The listing versions this shell can build menus from. */
export const KNOWN_NAVIGATION_VERSIONS = [1] as const
```

## 4. Activating an item

A menu click sends the item's **id** to the page. It does not load a URL. Loading a URL is a real navigation: it unmounts the workspace and ends any Salon reply still streaming. Sending the id runs the same code a rail click runs, so a menu click and a rail click cannot behave differently.

### 4.1 The bridge method the preload must expose

The server declares this on `window.quilltap` (`types/quilltap-bridge.d.ts`):

```ts
onNavigate?: (handler: (itemId: string) => void) => (() => void) | void
```

The page calls `window.quilltap.onNavigate(handler)` once its rail mounts. It calls the returned function, if there is one, when the rail unmounts. The page:

- registers **only after** the operator is signed in and the startup screen has cleared. Nothing registers on the unlock screen, the setup pages or the splash.
- registers again after every reload, because the handler lives in the page.
- ignores an id it does not know and logs a warning, so a stale menu cannot break it.
- ignores an item that is unavailable at the moment. Help needs a help-enabled character with a tool-capable connection, and the Brahma Console needs a connection profile. The rail dims these items; the menu sends them anyway (§5.3).

What the preload must do:

1. Keep **one** current handler. A new registration replaces the old one; a reload leaves the old one dead.
2. Return an unsubscribe that clears the handler only if it is still the current one.
3. Tell the main process whether a handler is registered, so the main process can pick the fallback (§4.3).
4. Deliver ids from the main process to the current handler.

A sketch:

```js
// preload.js
const { contextBridge, ipcRenderer } = require('electron')

let navHandler = null

ipcRenderer.on('quilltap:navigate', (_event, itemId) => {
  if (typeof navHandler === 'function') navHandler(String(itemId))
})

contextBridge.exposeInMainWorld('quilltap', {
  // ...existing bridge methods...
  onNavigate(handler) {
    navHandler = handler
    ipcRenderer.send('quilltap:nav-handler', true)
    return () => {
      if (navHandler === handler) {
        navHandler = null
        ipcRenderer.send('quilltap:nav-handler', false)
      }
    }
  },
})
```

### 4.2 The main process

```ts
// electron/main.ts
const navHandlerReady = new WeakMap<Electron.WebContents, boolean>()

ipcMain.on('quilltap:nav-handler', (event, ready: boolean) => {
  navHandlerReady.set(event.sender, Boolean(ready))
})

// In createMainWindow, beside the other webContents listeners. A
// cross-document navigation or a reload discards the page and its handler;
// forget it until the new page registers again. `did-navigate` fires only for
// the main frame's cross-document navigations (never for the workspace's
// in-page route changes), and fires before the new page's scripts run.
win.webContents.on('did-navigate', () => {
  navHandlerReady.set(win.webContents, false)
})

function activateNavItem(win: BrowserWindow, item: NavigationListingItem): void {
  const wc = win.webContents
  if (navHandlerReady.get(wc)) {
    wc.send('quilltap:navigate', item.id)
    return
  }
  // Fallback (§4.3).
  if (item.type === 'destination') {
    wc.loadURL(new URL(item.href, serverBaseUrl()).toString())
  }
}
```

The preload is shared by the splash window and the main window. Only the main window's Quilltap page ever calls `onNavigate`, so the splash never registers, and the flag is per `webContents` anyway.

### 4.3 The fallback

If no handler is registered (the page is still starting, the unlock screen is up, or the page is from a server without `onNavigate` support):

- **destination**: load `href`, resolved against the server's origin. Every destination href works as a page load. The `/workspace?open=<kind>` ones open that tab on arrival.
- **action**: do nothing. Actions only make sense in a running page.

Don't queue a click to replay once a handler appears. A click the operator made during startup should not fire a minute later.

## 5. Behaviour the shell can rely on

### 5.1 Ids are a permanent contract

An item id is written into the page as `data-nav`, which themes style, and the help pages and tests refer to items by id. Ids are never renamed or reused. An item can be removed; if one is, the shell must cope with it being absent (it will be, since the shell builds from the listing).

### 5.2 What each action does in the page

| Id | Effect |
|---|---|
| `new-chat` | Opens the New Chat dialog. |
| `document-mode` | Opens the document picker; the chosen document opens in Document Mode as a tab. |
| `themes` | Opens the theme panel next to the rail's Studio button. |
| `quick-hide` | Opens the quick-hide panel next to the rail's Quick-hide button. |
| `help` | Opens the help chat (ignored when no help character is eligible). |

The `themes` and `quick-hide` panels appear beside the rail, because the rail is always on screen, in the shell too.

### 5.3 No enablement in version 1

The listing does not say which items are unavailable, and the shell should not try to work it out. Show every item enabled. The page ignores a click on an unavailable item, and the rail shows the reason. If greyed menu items are wanted later, the server will add a field and say so here (§6).

### 5.4 The rail stays

The browser and the shell render the same rail. Nothing in the server hides it in the shell. A later "hide the rail in the shell" Appearance setting would read the capability in §7. That setting does not exist yet, and the shell must not hide the rail itself.

## 6. Versions and compatibility

- `version` rises only when an existing field changes meaning or goes away. Then the shell should show **no** navigation menus for a `version` it does not know. Don't guess.
- New fields can be added without raising `version`. Ignore fields you don't know.
- An item whose `type` is neither `destination` nor `action` is a future kind: leave it out of the menu.

**When the listing can't be used, keep today's Navigate menu.** That is the menu as it is now in `buildAppMenu`: the eight hard-coded items, `loadURL` on click, the same accelerators. A shell talking to an older server, which is common in remote mode and when a version is pinned, loses nothing. "Can't be used" means any of these:

- a `404` (a server before 4.14), any other non-200, or a network error;
- a body that doesn't parse, or isn't an object with `top`, `groups` and `pinned` arrays;
- a `version` the shell does not know.

| Shell | Server | Result |
|---|---|---|
| Today's (4.2.x) | 4.14+ | Today's Navigate menu, reloading on each click. The rail does the job properly. |
| New | Before 4.14 | The endpoint answers `404`, so the legacy Navigate menu is kept. Same as today. |
| New | 4.14+ | Go and the four groups, with clicks through `onNavigate`. |
| New, preload lacks `onNavigate` | 4.14+ | The page sees no bridge method and registers nothing. Every click takes the fallback: destinations load, actions do nothing. It works, but every click reloads the page. Ship the preload change with the menu. |

Don't retry a failed fetch for the life of that window; it is fetched again with the next main window (§2).

## 7. The capability flag

When the shell supports the menu bar, add `NATIVE_NAV_MENU` to `SHELL_CAPABILITIES` in `electron/constants.ts`. The embedded manager and the Docker manager both pass that constant to the server as `QUILLTAP_SHELL_CAPABILITIES`, a comma-separated list:

```ts
export const SHELL_CAPABILITIES = 'SPELLCHECK_DICTIONARY,NATIVE_NAV_MENU';
```

A remote server is not spawned by the shell and never sees the flag. That is fine: the menu does not depend on it.

Nothing on the server reads it in this version. It exists so that a later server feature (such as hiding the rail in the shell) can tell whether a menu bar is there to take its place.

## 8. Checklist for the shell's implementation

- [ ] `buildAppMenu` builds the bar at once with the legacy **Navigate**, fetches `GET /api/v1/system/navigation` from `serverBaseUrl()` without blocking, and rebuilds when it arrives. A new main window, from a restart or Change Site..., fetches again.
- [ ] **Go** (top, separator, pinned) and the four groups take Navigate's place, between Edit and View.
- [ ] Labels match the listing exactly, ellipses included.
- [ ] No hard-coded items; nothing disabled. The six existing accelerators are attached by id, and no new ones are added.
- [ ] Preload exposes `onNavigate`, keeps one handler, returns an unsubscribe, and reports registration to main.
- [ ] Main sends the item **id** when a handler is registered; otherwise loads `href` for a destination and does nothing for an action.
- [ ] The handler flag is cleared on `did-navigate` (cross-document navigation or reload), not on in-page route changes.
- [ ] `404`, a non-200, a bad body or an unknown `version` keep today's Navigate menu, and nothing crashes.
- [ ] Items of an unknown `type` and fields you don't know are ignored.
- [ ] `NATIVE_NAV_MENU` is added to `SHELL_CAPABILITIES` in `electron/constants.ts`.

To check it by hand against a 4.14 server:

1. Choose **Library → Files** while a Salon reply is streaming. Files opens as a tab and the reply keeps streaming, so the click went through `onNavigate` and nothing reloaded.
2. Choose **Studio → Theme…**. The theme panel opens beside the rail's Studio button.
3. Lock the instance, then choose **Go → Settings**. The page loads `/settings`, which is the fallback.
4. Lock the instance, then choose **Conversations → New Chat…**. Nothing happens.
5. Point the shell at a server older than 4.14 (remote mode, or a pinned version). Today's **Navigate** menu appears, works as before, and nothing errors.
6. Press `CmdOrCtrl+Shift+F` while a reply is streaming. Files opens as a tab and the reply carries on.

## 9. Where the server side lives

For reference only; the shell needs none of these files.

| What | Where |
|---|---|
| The table | `lib/navigation/registry.ts` |
| The listing | `lib/navigation/listing.ts` (`NAVIGATION_LISTING_VERSION`) |
| The route | `app/api/v1/system/navigation/route.ts` |
| The bridge type | `types/quilltap-bridge.d.ts` (`onNavigate`) |
| Registering the handler | `components/layout/left-sidebar/nav-rail-context.tsx` |
| What each id does | `components/layout/left-sidebar/activators.ts` |
| Tests | `__tests__/unit/app/api/v1/system/navigation/route.test.ts`, `__tests__/unit/components/layout/left-sidebar.test.tsx` (native menu click case) |
| API reference | `docs/developer/API.md`, "System Navigation" |
