# Avatar Configuration Cache

**Status:** implemented (4.10-dev), not yet exercised against a live instance · **Introduced:** 4.10.0

One avatar per character *per configuration*, generated once and reused, instead
of a fresh provider call every time a character puts the same coat back on.

## The observation

`buildCharacterAvatarPrompt` (`lib/wardrobe/avatar-prompt.ts`) is a pure
function. No clock, no RNG, no LLM. Given the same character fields, the same
resolved outfit, the same in-scope stores and the same project aesthetic, it
returns a byte-identical string. Everything deterministic about an avatar —
the head-and-shoulders physical variant, the expanded leaf outfit, the pronoun
subject noun, the bare-top collarbone crop, the capped art-direction preamble —
is already folded into that one string by the time it is returned.

So the prompt *is* the canonical serialization of the deterministic inputs.
There is nothing to hash separately.

What the prompt does **not** carry is the provider-side shape: model, LoRAs,
stored profile options, size. Two profiles on the same model with different
LoRAs produce different pictures from identical prompt text. Those come from
`buildImageGenParams` (`lib/image-gen/params-builder.ts`) and must be in the key.

## The key

```
generationKey = sha256(canonicalJson({
  v: 1,
  provider, imageProfileId,
  params,          // the full buildImageGenParams output — prompt and model included
}))
```

`canonicalJson` sorts object keys recursively so key order can never change the
hash. The key is derived from the **pre-reroute** profile, so the lookup can
happen before the Concierge classification call and save that too.

Derivation and lookup live in one chokepoint, `lib/wardrobe/avatar-cache.ts`.
No call site computes a key itself.

### Legacy keys (v0)

Rows that predate this feature cannot reproduce `params` — the LoRAs and
options in force at generation time are not recorded. They get a
lower-fidelity key instead:

```
legacyKey = sha256(canonicalJson({ v: 0, modelName, prompt }))
```

The `v` discriminator means a v0 key can never collide with a v1 key. Lookup
tries the v1 key first, then the v0 key. A v0 hit is **not** upgraded to a v1
key: we cannot verify the params matched, and two indexed reads cost nothing.

## Storage: the vault, always

Reading a mount blob is `repos.docMountBlobs.readData(blobId)`
(`lib/file-storage/project-store-bridge.ts`) — addressed by blob id, with no
project scoping and no permission check, because an instance has one user. A
chat in any project can therefore render a `fileId` whose bytes sit in the
character's vault. **Nothing needs to be hard-linked for cross-project reuse to
work.**

`linkGroupId` hard links exist to give POSIX write-through on *mutable*
documents — `fanOutGroupFileId` on write, `reindexLinkGroupSiblings` rebuilding
chunk sets afterward. Avatar bytes are never edited in place; the history path
is append-only with unique-suffix bumping. Binding a link group would buy a
property that cannot apply, and cost group maintenance and GC semantics.

So the handler drops its `chat.projectId` branch: every generated avatar goes to
`writeCharacterAvatarToVault({ kind: 'history' })`, `projectId: null`,
`folderPath: null`. Consequences:

- the storage tier leaves the cache key entirely — maximum hit rate, and
  cross-project reuse for free;
- every portrait of a character lands in one place, which is where you would
  browse them anyway, and retention becomes a single-mount sweep;
- the `repos.folders.ensureByPath('/character-avatars/')` call disappears from
  the avatar path — one fewer legacy folder row per image (cf. bug 114).

Two costs, accepted deliberately:

- **Behaviour change.** Project-context avatars no longer appear in that
  project's file tree. Existing rows keep their `storageKey` and still resolve;
  the migration does not move bytes.
- **The vault becomes a hard dependency.** `writeCharacterAvatarToVault` throws
  when `getCharacterVaultStore` returns null, and the handler cannot
  `ensureCharacterVault` inline (readonly child, no read-your-writes). A
  character with a broken vault previously still got an avatar in a project
  chat; now it gets none. Consistent with the established vault failure
  semantics, but a wider blast radius.

**Archived characters are untouched by this.** The handler never provisions a
vault, so the tombstone rules are unaffected.

## Flow

1. Build the prompt (`buildCharacterAvatarPrompt`).
2. Build params from the **original** profile.
3. Derive the key.
4. Unless `force`, look it up. On a hit whose blob still exists → bind and stop.
5. On a miss: Concierge classification → possible reroute → generate.
6. Write to the vault, `files.create` with `generationKey` set to the key from
   step 3.
7. Bind `chat.characterAvatars` and `character.avatarOverrides` to the file id.

### `force` — the reroll

`force: true` on the job payload skips the lookup, generates, and **rebinds the
key to the new file**. That is what makes the regenerate button a reroll: the
new image becomes canonical for that character *and that configuration*, not
for the character. The character's canonical `images/avatar.webp`
(`kind: 'main'`) is a different path and is not touched.

Key binding is therefore last-write-wins, not append-only. The previous holder
of the key keeps its file row and its bytes; it simply stops being the answer.

`app/api/v1/chats/[id]/actions/regenerate-avatar.ts` sets `force`. Automatic
wardrobe-change triggers do not.

### The reroute keys under the requested profile

If the Concierge swaps in an uncensored profile mid-job, the image is stored
under the *original* profile's key. That is correct — same inputs, same
outcome, deterministically — but it means a cached row's `generationModel` need
not match the model named in its key. Documented, not "fixed".

### Deletion blast radius

`deleteMountBlob` deletes every link to the blob's file, because the storageKey
was the user-visible handle. With a cache, many chats point at one `fileId`, so
deleting one avatar through the file UI breaks more places than before. The
lookup therefore verifies the blob still exists (`mountBlobExists`) before
returning a hit: a missing blob is a miss, regenerates, and rebinds the key.
Self-healing, one extra indexed read.

### Concurrency

The handler runs in the forked job child: reads pass through, writes buffer, no
read-your-writes. Two avatar jobs racing on one key both miss and both
generate; the second write wins the key. A wasted call, not a corruption.

### The Lantern stays quiet on a hit

`postLanternImageNotification` announces a produced image. A cache hit produced
nothing, so it is suppressed — the avatar still updates through the normal
realtime path. A forced reroll announces as it always did.

## Schema

`files.generationKey TEXT` (nullable), with `idx_files_generationKey`. Nullable
because most file rows are not avatars and never carry one.

## Migration

Two scripts, in order.

1. **`add-file-generation-key-column-v1`** — the column and its index.

2. **`collapse-duplicate-avatar-rolls-v1`** — assign v0 keys to existing avatar
   rows and collapse each configuration to a single roll.

   Measured on a production instance before writing this: 1786 avatar rows,
   282 MB, all resident in `quilltap-mount-index.db` (of 811 MB total). 889
   distinct `(generationPrompt, generationModel)` pairs. 260 rows referenced by
   no chat. Collapsing frees roughly 141 MB.

   Per `(generationPrompt, generationModel)` group:

   - survivor = newest `createdAt`; it receives the v0 `generationKey`;
   - every reference to a non-survivor is repointed to the survivor:
     `chats.characterAvatars`, `characters.avatarOverrides`, and
     `chat_messages.attachments`;
   - the Lantern announcement that attached a deleted roll also quotes its uuid
     inline ("catalogued under uuid `…`"), so that id is substituted in the
     message's `content` and `opaqueContent` too. 1912 messages reference an
     avatar file on the measured instance; without this they would render a
     broken attachment and name a file that no longer exists, to the reader and
     to any model that later reads the transcript. A mechanical id swap — no
     prose is rewritten;
   - non-survivors are deleted: the `files` row, then in the mount-index DB the
     chunks by `linkId`, the `doc_mount_file_links` row, and — when that was the
     last link for the file — `doc_mount_files`, `doc_mount_blobs` and
     `doc_mount_documents`. Deletions are explicit rather than left to
     `ON DELETE CASCADE`, since tables generated from the Zod schema carry no
     foreign keys.

   A group of one keeps its row and gains a key, including unreferenced ones —
   an orphaned roll is a perfectly good cache entry for its configuration.

   A roll whose blob a character still names as its `defaultImageId` is never a
   victim. It is excluded from the victim list up front and keyed alongside the
   survivor, rather than skipped at deletion time: skipping late would either
   strand a `files` row whose bytes survived, or leave the row unkeyed and
   re-trigger the whole migration on every startup.

   **This is destructive and visible.** The duplicates are not redundant bytes;
   they are different seeds of the same prompt. Around 637 chat/character pairs
   will show a different portrait than they did before, irreversibly. The
   instance owner chose full automatic collapse over a two-phase opt-in sweep
   with that consequence stated.

   Rows with an empty `generationPrompt` are skipped — there is no key to
   derive, so they are neither collapsed nor deleted.
