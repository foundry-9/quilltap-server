# Bug 142 — `deleteMessagesByIds` counts a message it did not delete, so a no-op delete bumps the transcript counter and tells every open tab to re-read

| | |
|---|---|
| **Status** | Fixed |
| **Found** | 2026-09-14 |
| **Fixed** | 2026-09-14 |
| **Severity** | Low today, and rising (nothing is lost or corrupted: `messageCount` and `lastMessageAt` are recomputed from what survives, so they land on the right values either way. What is wrong is the *count* — the return value every caller reports from, and, since `5029075bb`, a `transcriptVersion` bump and a realtime hint for a delete that deleted nothing) |
| **Who it bites** | Every caller of `deleteMessagesByIds` that shows or logs its result — the Commonplace whisper sweep reports "swept N", and N is the number of ids it *asked* about. With the subscribed transcript read live, it also costs each open Salon tab on that chat a full conditional re-read per phantom delete |
| **Provenance** | **Pinned.** Found by the v5 port's tier-2 funnel census (`chats_messages_ops_tier2_equivalence`) when `transcriptVersion` became a compared cell: v4 reached 3 on a chat where v5 reached 2, and the extra bump was a delete of an id that was not there. v5 is left correct and the divergence is asserted in both directions as `DELETE_MISS_DIVERGENCE` — the day v4 converges, the pin trips and names itself |
| **Defect site** | `lib/database/repositories/chats-messages.ops.ts:638-646` (the `removed` accumulator) — the ONLY one of `deleteOne`'s seven callers in `lib/` that does not read `result.deletedCount`, given `lib/database/backends/sqlite/backend.ts:289` and the `DeleteResult` return type declared at `lib/database/interfaces.ts:286` |
| **v5 status** | **Does not reproduce — deliberately.** v5's `delete_messages_by_ids` counts `rows affected` from its own `DELETE`, which is 0 on a miss. Reproducing v4 here would mean regressing a path that works and miscounting deletions for every caller, so the port keeps the correct behaviour and pins the difference instead |
| **Index** | [bugs.md](../../bugs.md) |


---

**FIXED in v4 (2026-09-14).** `removed += result.deletedCount` — the comment and
both stale branches deleted, which is what the other six `deleteOne` callers in
`lib/` already did (`vector-indices.repository.ts:235` is the same accumulator
loop, written correctly; the fix now matches it verbatim). A delete that removed
nothing returns 0, logs nothing, leaves `chats.transcriptVersion` where it was,
and publishes no hint; a mixed batch reports only the rows it took and still
announces once, because it did change the transcript.

The mock that hid it was corrected first, exactly as this write-up proposed:
`chats-messages-transcript-version.test.ts` now returns
`{ deletedCount, acknowledged: true }` from both `deleteOne` and `deleteMany`,
and with the source left alone that alone reddened
`says nothing when nothing was removed` — the cheapest reproduction, taken
before the fix.

Because a double is what let this live for so long, the durable guard is not
another double: `__tests__/unit/lib/database/repositories/chats-messages-delete-count.integration.test.ts`
runs `ChatMessagesOps` against a real `SQLiteCollection` over a real in-memory
database and asserts all four verification cases plus a cross-chat miss, and
separately pins the backend contract itself — `deleteOne` returns
`{ deletedCount: 0, acknowledged: true }` on a miss, a truthy object, never a
number and never a boolean. Four of its six cases fail against the unfixed
source.

No caller's behaviour changes beyond the count becoming true: all three
consumers of the return value (`context-summary.ts:463`,
`context-manager.ts:2212` and `:2502`) only log it.

## Symptom

Ask `deleteMessagesByIds` to delete a message id that does not exist in the
chat, and it reports that it deleted one. Ask it for three ids of which one
exists, and it reports three.

Since `5029075bb` the consequence is visible from outside the repository layer:
a delete that removed nothing takes the `removed > 0` path, so it bumps
`chats.transcriptVersion` and publishes a `{topic:'chats', id}` hint. Every
Salon tab on that chat is told its transcript changed, performs the conditional
re-read, and is handed a transcript identical to the one it already had.

## Root cause

`lib/database/repositories/chats-messages.ops.ts:638-648`:

```ts
const result = await messagesCollection.deleteOne({ id: messageId, chatId } as QueryFilter);
// deleteOne may return either a count or a boolean depending on backend
if (typeof result === 'number') {
  removed += result;
} else if (result) {
  removed += 1;
}
```

The comment says "a count or a boolean". The real SQLite backend returns
neither — `lib/database/backends/sqlite/backend.ts:289` returns a
`DeleteResult`:

```ts
const existing = await this.findOne(filter);
if (!existing) {
  return { deletedCount: 0, acknowledged: true };
}
```

`typeof {…} !== 'number'`, and `{ deletedCount: 0, acknowledged: true }` is a
**truthy object**, so the `else if` fires and `removed` is incremented for a row
that was never there. The accumulator therefore always ends at
`messageIds.length`, whatever the table contained — the loop cannot return
anything else.

The comment is defending against shapes the interface says cannot occur.
`lib/database/interfaces.ts:286` declares
`deleteOne(filter): Promise<DeleteResult>`, and `DeleteResult` (`:151`) is
`{ deletedCount: number; acknowledged: boolean }` — there is no "count or
boolean depending on backend" to guard against, and the one shape that *is*
declared is the only one the code does not handle.

**And every other call site already gets this right.** Of the seven callers of
`deleteOne` in `lib/`, six read `result.deletedCount` directly —
`base.repository.ts:399`, `vector-indices.repository.ts:214` and `:236`,
`connection-profiles.repository.ts:392`, `embedding-status.repository.ts:390`,
`tfidf-vocabulary.repository.ts:191`. `chats-messages.ops.ts:639` is the lone
outlier, and the only one carrying the stale comment.

Nothing downstream corrects it. `removed > 0` then guards a block that
recomputes `messageCount` and `lastMessageAt` from the surviving rows (both
land on the right values, which is why this stayed invisible for so long),
calls `commitTranscriptChange`, and logs
`Messages deleted from chat { chatId, removed, requested }` — where `removed`
and `requested` are now always equal.

## Why it survived

`__tests__/unit/lib/database/repositories/chats-messages-transcript-version.test.ts:57`
mocks the collection, and the mock returns the shape the comment describes:

```ts
deleteOne: jest.fn(async (filter: { id: string }) => {
  const at = rows.findIndex((r) => r.id === filter.id)
  if (at < 0) return 0
  rows.splice(at, 1)
  return 1
}),
```

A **number**. That takes the first branch, where the arithmetic is correct — so
the suite's own `deleteMessagesByIds — says nothing when nothing was removed`
passes, against a mock that does not behave like the backend it stands in for.
The test asserts the intended contract and the production path has never met it.

It needed a differential over a **real** encrypted database to surface, and even
then only after `5029075bb` gave the repository a counter: until `transcriptVersion`
existed, the only observable effects of the phantom `removed > 0` were a
`messageCount` and a `lastMessageAt` recomputed to the values they already had.
The discrepancy was real from the beginning and produced no difference anything
could compare.

## The fix

Do what the other six call sites do — read the field the interface declares,
and delete the comment along with the branches it was justifying:

```ts
const result = await messagesCollection.deleteOne({ id: messageId, chatId } as QueryFilter);
removed += result.deletedCount;
```

That is the whole fix. The `typeof result === 'number'` and bare-truthiness
branches are not defensive breadth to be preserved: they describe a return
shape `DatabaseCollection.deleteOne` has never been able to produce, and the
second of them is what swallows the real answer.

Worth doing alongside, since it is what let this live: the mock at
`__tests__/unit/lib/database/repositories/chats-messages-transcript-version.test.ts:57`
should return `{ deletedCount, acknowledged: true }` rather than `0`/`1`, so
the suite stops standing in for a backend that does not exist. With the mock
corrected and the source left alone, that file's
`says nothing when nothing was removed` fails — which is the cheapest possible
reproduction, and worth writing first.

## Verification

Against a real SQLite instance (not the mock):

1. `deleteMessagesByIds(chatId, ['no-such-id'])` returns **0**, not 1.
2. It logs nothing and leaves `chats.transcriptVersion` where it was — v4's own
   test title, `says nothing when nothing was removed`, finally describing the
   production path.
3. `deleteMessagesByIds(chatId, [realId, 'no-such-id'])` returns **1**, and
   bumps the counter exactly once.
4. The mixed case is the one to keep: a batch that deletes *some* of what it was
   asked about must still announce, because it did change the transcript.

## v5 coordination

The v5 port asserts this divergence in both directions in
`crates/quilltap-harness/tests/chats_messages_ops_tier2_equivalence.rs`
(`DELETE_MISS_DIVERGENCE`): v5 writes 2 where v4 writes 3 on the corpus's
delete chat, and **both values are asserted**. When this fix lands, that pin
fires by name and tells the v5 side to retire it to a plain equality — the
tripwire working, not a regression. No v5 source change is needed; v5 already
does the right thing.
