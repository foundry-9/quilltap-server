# Custom-Tool Run Presets

Status: **implemented** (alongside the `{{state.path}}` describe fix in the consult-prompt schema).

## Problem

The Salon's custom-tool run dialog (`components/chat/CustomToolRunDialog.tsx`) seeds each tool's parameter fields from the definition's defaults once, and remembers the operator's last-typed values only while the composer stays mounted. There is no way to keep a named set of parameter values around — a "loadout" for a tool the operator runs the same few ways over and over.

## Design

### Where presets live

A preset is an ordinary JSON document in any store on the running character's **tool walk**, next to the tool definitions:

```
Tools/{toolname}.{preset}.settings.json
```

- `{toolname}` is the tool's identity (`definition.name`), which matches `IDENTIFIER_PATTERN` (`/^[a-z][a-z0-9_-]{0,63}$/`, `lib/pascal/custom-tool.types.ts`) and therefore never contains a dot.
- `{preset}` is the operator's chosen name, constrained to `/^[a-z0-9][a-z0-9_-]{0,63}$/` — no spaces, dots, or path delimiters — so the filename parses unambiguously and is safe on every filesystem shape a vault can take.
- The file body is a **flat JSON object** of parameter name → value, exactly what `coerceParamValues` produced at save time. Hand-editable on purpose.

Roster discovery only takes `Tools/*.tool.json` from the shared `Tools/` listing (`listToolsFolderFiles`, `lib/pascal/custom-tools.ts`), so `.settings.json` files can never leak into the roster. Because presets are ordinary store documents they ride along in export/backup with no schema changes, and can be deleted or renamed through any existing file surface.

### Which stores, and which preset wins

*(Revised 4.12: presets were first read from and saved to the character's vault only.)*

Presets are found by the walk that finds definitions: `resolveTieredMountPool` (no participant tier) ordered by the roster's own `orderedMounts` — character vault, then group stores, then project stores, then Quilltap General, same-tier ties by mount id. A nearer preset of a name **shadows** a farther one, as a nearer `.tool.json` shadows a farther definition; the losers are reported on the winner as `shadows`. That walk is `resolveToolPresetPool` (`lib/pascal/tool-preset-pool.ts`), served as `GET /api/v1/chats/[id]/custom-tools?action=presets&tool=…&asCharacterId=…`. It also returns every enabled store on the walk, nearest first, as `stores` — the dialog's save destinations — and any store whose `Tools/` folder would not list as `unread` (its presets are missing, not absent; it stays a save destination). A disabled mount is neither read nor offered.

Saving writes into one chosen store, the character's vault by default (`vaultMountPointId` on the roster row), or the nearest store when the character has no vault. A personal preset therefore shadows a shared one of the same name instead of overwriting it; saving into the shared store itself is a deliberate choice in the **Save into** selector. Loading a preset does not move the save destination.

### Loose binding

Loading a preset is deliberately **not** schema-bound: for each parameter the tool currently declares, if the preset object has a key of that name holding a primitive, that value lands in the form (`boolean` params get `Boolean(v)`, everything else `String(v)` — the `initialParamValues` convention); every other key is ignored, and parameters the preset doesn't mention keep their current values. A preset saved against an older revision of a tool therefore degrades gracefully instead of erroring.

### Pieces

- **`lib/pascal/tool-presets.ts`** — pure, client-safe helpers: `PRESET_NAME_PATTERN`, `sanitizePresetNameInput` (the input's keystroke filter: lowercase, strip anything outside `[a-z0-9_-]`, cap at 64), `presetSettingsPath`, `parsePresetFromPath`. Unit-tested in `lib/pascal/__tests__/tool-presets.test.ts`.
- **`lib/pascal/tool-preset-pool.ts`** — `resolveToolPresetPool`, the tier walk above. Unit-tested in `__tests__/unit/lib/pascal/tool-preset-pool.test.ts`.
- **Roster route** (`app/api/v1/chats/[id]/custom-tools/route.ts`) — `CustomToolListing.vaultMountPointId` (the running character's vault, the default save destination) and the `?action=presets` GET, which resolves its perspective as `?action=run` does. Reads and writes of the files themselves go through the canonical mount-points routes (`GET/PUT /api/v1/mount-points/{id}/files/{relPath}`), never a second write path.
- **Run dialog** (`components/chat/CustomToolRunDialog.tsx`) — a "Presets" section in the tool's form phase, rendered when the tool declares parameters and the row names an `asCharacterId`:
  - a dropdown of the walk's winning presets, each labelled with its store (query key `queryKeys.customTools.presets(chatId, asCharacterId, toolName)`); hovering an entry names the stores it shadows;
  - selecting one fetches it from its own store and applies it (and copies its name into the name input);
  - a name input (locked to the preset charset as typed) plus a **Save** button (PUT, overwrite semantics within the chosen store);
  - a **Save into** selector over the walk's stores, defaulting to the vault;
  - a **Reset to defaults** button re-seeding the form from `initialParamValues`.

### Out of scope

- Pascal's Workbench proving bench (different form-state model; possible follow-up).
- Preset deletion UI — the files are ordinary vault documents, deletable via existing file surfaces.
- `run_custom` (a model's roll) does not read presets; they are the operator's convenience in the dialog.
