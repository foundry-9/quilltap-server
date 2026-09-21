/**
 * The sync planner. PURE: two walks, a base, and the options in; a list of
 * actions out. No SQLite, no `fs`, no clock.
 *
 * Everything the sync decides is decided here, which is what makes the
 * decision table testable row by row rather than by running a sync and
 * inspecting a directory afterwards.
 *
 * The rules, in one place:
 *
 *   - **SHA-256 first, timestamps second.** Equal bytes and unequal clocks is
 *     a `touch`, never a copy. This is with the grain of the mount index,
 *     whose scanner already decides "unchanged" purely by sha.
 *   - **A difference is resolved by the newer side**, unless the base shows
 *     both sides moved since the last agreement — that is a `conflict`,
 *     reported and skipped. `--prefer store|disk` overrides both.
 *   - **A deletion propagates only when the base proves it.** With no base —
 *     a first run — an entry missing on one side is created there. The sync
 *     never deletes something it has no record of.
 *   - **`createdAt` takes the older of the two.** A file's creation date must
 *     not move later merely because a copy of it was made.
 *
 * @module mount-index/sync/planner
 */

import * as posixPath from 'path/posix';
import { descriptionSha256, descriptionsEqual } from './sidecar';
import {
  MTIME_TOLERANCE_MS,
  hasSidecar,
  type ManifestEntry,
  type SyncAction,
  type SyncEntry,
  type SyncEntryMap,
  type SyncOptions,
  type SyncSide,
} from './types';

/**
 * A character vault's keystones. `writeCharacterVaultManagedFields` writes
 * these unconditionally, and the overlay treats a vault without them as
 * broken, so a sync must never propagate their deletion from disk — an
 * operator who tidied a directory would otherwise hollow the character.
 * Mirrors `REQUIRED_VAULT_FILES` in `character-vault.ts`, plus the dressing
 * instructions the wardrobe reads.
 */
export const CHARACTER_VAULT_KEYSTONES: readonly string[] = [
  'properties.json',
  'identity.md',
  'description.md',
  'manifesto.md',
  'personality.md',
  'example-dialogues.md',
  'wardrobe/instructions.md',
];

export interface PlanInput {
  store: SyncEntryMap;
  disk: SyncEntryMap;
  base: Map<string, ManifestEntry>;
  options: SyncOptions;
  /** True for a `storeType = 'character'` store: keystone deletions are refused. */
  isCharacterVault: boolean;
  /**
   * Whether this platform can be made to report the creation date the sync
   * asks for (macOS, via the `utimes` two-step). Where it cannot, a disk
   * `createdAt` that disagrees must NOT drive a `touch`: the touch could not
   * change the answer, the next walk would read the same disagreement, and the
   * sync would plan the same futile action every run forever. The manifest
   * carries the value instead, so the comparison stays right even where the
   * filesystem's own answer cannot be.
   */
  canSetDiskBirthtime: boolean;
}

// ============================================================================
// Comparison helpers
// ============================================================================

function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Within {@link MTIME_TOLERANCE_MS} counts as the same instant. */
function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = timeOf(a);
  const y = timeOf(b);
  if (x === null || y === null) return x === y;
  return Math.abs(x - y) <= MTIME_TOLERANCE_MS;
}

/** The older of two creation dates; a side that cannot say never wins. */
function olderCreatedAt(a: string | null | undefined, b: string | null | undefined): string | null {
  const x = timeOf(a);
  const y = timeOf(b);
  if (x === null) return b ?? null;
  if (y === null) return a ?? null;
  return x <= y ? (a ?? null) : (b ?? null);
}

function humanGap(aIso: string, bIso: string): string {
  const ms = Math.abs(new Date(aIso).getTime() - new Date(bIso).getTime());
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return 'moments';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) return rem ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

// ============================================================================
// Plan
// ============================================================================

export function planSync(input: PlanInput): { actions: SyncAction[]; warnings: string[] } {
  const { store, disk, base, options, isCharacterVault, canSetDiskBirthtime } = input;
  const warnings: string[] = [];
  const actions: SyncAction[] = [];

  const keys = new Set<string>([...store.keys(), ...disk.keys(), ...base.keys()]);

  // Folders first, then files — a `create disk` needs its directory to exist,
  // and the folder ordering below puts parents before children. Deletions are
  // re-sorted at the end, children before parents.
  const folderActions: SyncAction[] = [];
  const fileActions: SyncAction[] = [];
  const deleteActions: SyncAction[] = [];

  /** Paths whose store-side content this plan rewrites; their group siblings are stale on disk. */
  const storeRewrites = new Set<string>();

  for (const key of keys) {
    const s = store.get(key);
    const d = disk.get(key);
    const b = base.get(key);

    // The kinds disagree — one side has a directory where the other has a
    // file. Nothing sensible to do but say so.
    if (s && d && s.kind !== d.kind) {
      fileActions.push(conflictAction(
        s.relativePath, s.kind,
        `a ${s.kind} in the store, a ${d.kind} on disk`
      ));
      continue;
    }

    const kind = (s ?? d ?? null)?.kind ?? (b?.kind ?? 'file');
    const sink = kind === 'folder' ? folderActions : fileActions;

    if (!s && !d) {
      // Gone from both sides; the manifest simply forgets it.
      continue;
    }

    // ---- present on one side only -------------------------------------
    if (s && !d) {
      const storeChanged = !b || b.sha256 !== s.sha256;
      if (!b) {
        push(sink, materialise('disk', s, olderCreatedAt(s.createdAt, null)), options);
        // A newly-materialised binary takes its caption with it; the
        // both-sides path below never sees this entry.
        if (hasSidecar(s.fileType) && (s.description ?? '').length > 0) {
          push(sink, {
            kind: 'describe', side: 'disk', relativePath: s.relativePath, entryKind: 'file',
            description: s.description, lastModified: s.descriptionUpdatedAt ?? s.lastModified,
            outcome: 'planned',
          }, options);
        }
      } else if (storeChanged && kind === 'file') {
        // Edited in the store, deleted on disk. Either answer discards work.
        sink.push(conflictAction(
          s.relativePath, kind,
          'edited in the store and deleted on disk'
        ));
      } else if (!options.propagateDeletes) {
        sink.push(skipAction(s.relativePath, kind, 'deleted on disk (--no-delete)'));
      } else if (isCharacterVault && isKeystone(s.relativePath)) {
        sink.push(conflictAction(
          s.relativePath, kind,
          'a character vault keystone cannot be deleted by a sync'
        ));
      } else {
        push(sink, removal('store', s, 'deleted on disk since last sync'), options);
      }
      continue;
    }

    if (d && !s) {
      const diskChanged = !b || b.sha256 !== d.sha256;
      if (!b) {
        push(sink, materialise('store', d, olderCreatedAt(null, d.createdAt)), options);
        // The sidecar beside a file being adopted into the store is its
        // caption; the link it belongs to does not exist until the create
        // above lands, so the applier resolves it by path.
        if ((d.description ?? '').length > 0 && !isTextPath(d.relativePath)) {
          push(sink, {
            kind: 'describe', side: 'store', relativePath: d.relativePath, entryKind: 'file',
            description: d.description, lastModified: d.descriptionUpdatedAt ?? d.lastModified,
            outcome: 'planned',
          }, options);
        }
      } else if (diskChanged && kind === 'file') {
        sink.push(conflictAction(
          d.relativePath, kind,
          'edited on disk and deleted in the store'
        ));
      } else if (!options.propagateDeletes) {
        sink.push(skipAction(d.relativePath, kind, 'deleted in the store (--no-delete)'));
      } else {
        push(sink, removal('disk', d, 'deleted in the store since last sync'), options);
      }
      continue;
    }

    if (!s || !d) continue; // unreachable; satisfies the narrowing

    // ---- present on both sides ----------------------------------------
    if (kind === 'folder') {
      // A folder that exists on both sides has nothing to reconcile: its
      // timestamps are not meaningful (every file written into it moves the
      // directory's mtime) and its contents are separate entries.
      continue;
    }

    const contentEqual = s.sha256 === d.sha256;

    if (!contentEqual) {
      const winner = chooseWinner(s, d, b, options);
      if (winner === 'conflict') {
        fileActions.push(conflictAction(
          s.relativePath, 'file',
          'both sides changed; --prefer to resolve'
        ));
        continue;
      }
      const from = winner === 'store' ? s : d;
      const to: SyncSide = winner === 'store' ? 'disk' : 'store';
      const gap = humanGap(s.lastModified, d.lastModified);
      const reason =
        options.prefer !== 'newer'
          ? `--prefer ${options.prefer}`
          : `${winner} newer by ${gap}`;
      const action = materialise(to, from, olderCreatedAt(s.createdAt, d.createdAt));
      action.kind = 'modify';
      action.reason = reason;
      // The store's path casing is authoritative on the store side; the disk's
      // on the disk side. A pure-case rename follows the content winner.
      action.relativePath = to === 'store' ? d.relativePath : s.relativePath;
      action.linkId = s.linkId;
      action.expectedStoreSha256 = s.sha256;
      push(fileActions, action, options);
      if (to === 'store') storeRewrites.add(key);
    } else {
      // Bytes agree. Timestamps may not.
      const winnerTime = newerTimestamp(s, d, options);
      const targetCreatedAt = olderCreatedAt(s.createdAt, d.createdAt);

      if (!sameInstant(s.lastModified, winnerTime) || !sameInstant(s.createdAt, targetCreatedAt)) {
        push(fileActions, {
          kind: 'touch', side: 'store', relativePath: s.relativePath, entryKind: 'file',
          lastModified: winnerTime, createdAt: targetCreatedAt,
          reason: `mtime ${winnerTime}`,
          linkId: s.linkId, outcome: 'planned',
        }, options);
      }
      const diskBirthOff =
        canSetDiskBirthtime && d.createdAt !== null && !sameInstant(d.createdAt, targetCreatedAt);
      if (!sameInstant(d.lastModified, winnerTime) || diskBirthOff) {
        push(fileActions, {
          kind: 'touch', side: 'disk', relativePath: d.relativePath, entryKind: 'file',
          lastModified: winnerTime,
          createdAt: canSetDiskBirthtime ? targetCreatedAt : undefined,
          reason: `mtime ${winnerTime}`,
          outcome: 'planned',
        }, options);
      }
    }

    // ---- descriptions --------------------------------------------------
    planDescription(s, d, b, options, fileActions, warnings);
  }

  // A store-side rewrite fans out to the writer's hard-link group, so the
  // siblings' disk copies are stale the moment this run lands. Refresh them in
  // the SAME run rather than leaving the operator to invoke the verb twice.
  planGroupFanOut(store, disk, storeRewrites, options, fileActions, warnings);

  // Deletions go last, children before parents, so an `rmdir` finds an empty
  // directory. Everything else runs parents-first.
  for (const action of [...folderActions, ...fileActions]) {
    if (action.kind === 'delete' || action.kind === 'rmdir') deleteActions.push(action);
  }
  const creations = [...folderActions, ...fileActions].filter(
    a => a.kind !== 'delete' && a.kind !== 'rmdir'
  );

  // Store-side work runs first. A hard-link fan-out reads the sibling's bytes
  // back out of the store, so the write that produced them must already have
  // landed; nothing else depends on the order across sides.
  creations.sort(storeFirstThen(byPathDepth(1)));
  deleteActions.sort(byPathDepth(-1));

  actions.push(...creations, ...deleteActions);
  return { actions, warnings };
}

// ============================================================================
// Pieces
// ============================================================================

/**
 * A disk-side guess at whether a path will land in the store as a text
 * document rather than a blob. The store walk knows the real `fileType`, but
 * on a first-run adoption there is no store entry yet, and only a blob can
 * carry a caption.
 */
function isTextPath(relativePath: string): boolean {
  return /\.(md|markdown|txt|json|jsonl|ndjson)$/i.test(relativePath);
}

function isKeystone(relativePath: string): boolean {
  return CHARACTER_VAULT_KEYSTONES.includes(relativePath.toLowerCase());
}

/** Store-side actions before disk-side ones; ties broken by `next`. */
function storeFirstThen(next: (a: SyncAction, b: SyncAction) => number) {
  const rank = (a: SyncAction) => (a.side === 'store' ? 0 : a.side === 'disk' ? 1 : 2);
  return (a: SyncAction, b: SyncAction): number => (rank(a) - rank(b)) || next(a, b);
}

/** Folders before files at the same depth, then shallow-to-deep (or the reverse). */
function byPathDepth(sign: 1 | -1) {
  return (a: SyncAction, b: SyncAction): number => {
    const depth = (p: string) => p.split('/').length;
    const byDepth = (depth(a.relativePath) - depth(b.relativePath)) * sign;
    if (byDepth !== 0) return byDepth;
    if (a.entryKind !== b.entryKind) return a.entryKind === 'folder' ? -1 * sign : 1 * sign;
    return a.relativePath.localeCompare(b.relativePath);
  };
}

function conflictAction(relativePath: string, entryKind: 'file' | 'folder', reason: string): SyncAction {
  return { kind: 'conflict', side: null, relativePath, entryKind, reason, outcome: 'skipped' };
}

function skipAction(relativePath: string, entryKind: 'file' | 'folder', reason: string): SyncAction {
  return { kind: 'skip', side: null, relativePath, entryKind, reason, outcome: 'skipped' };
}

/** `create`/`mkdir` on `side`, taking `from`'s content and clocks. */
function materialise(side: SyncSide, from: SyncEntry, createdAt: string | null): SyncAction {
  return {
    kind: from.kind === 'folder' ? 'mkdir' : 'create',
    side,
    relativePath: from.relativePath,
    entryKind: from.kind,
    lastModified: from.lastModified,
    createdAt,
    sha256: from.sha256,
    sizeBytes: from.sizeBytes,
    linkId: from.linkId,
    outcome: 'planned',
  };
}

function removal(side: SyncSide, from: SyncEntry, reason: string): SyncAction {
  return {
    kind: from.kind === 'folder' ? 'rmdir' : 'delete',
    side,
    relativePath: from.relativePath,
    entryKind: from.kind,
    reason,
    linkId: from.linkId,
    outcome: 'planned',
  };
}

/** `--direction` filters the plan; a filtered-out action becomes a `skip` line. */
function push(sink: SyncAction[], action: SyncAction, options: SyncOptions): void {
  if (options.direction === 'both' || action.side === null) {
    sink.push(action);
    return;
  }
  const allowed: SyncSide = options.direction === 'to-disk' ? 'disk' : 'store';
  if (action.side === allowed) {
    sink.push(action);
  } else {
    sink.push(skipAction(action.relativePath, action.entryKind, `--direction ${options.direction}`));
  }
}

function newerTimestamp(s: SyncEntry, d: SyncEntry, options: SyncOptions): string {
  if (options.prefer === 'store') return s.lastModified;
  if (options.prefer === 'disk') return d.lastModified;
  const sm = timeOf(s.lastModified) ?? 0;
  const dm = timeOf(d.lastModified) ?? 0;
  return sm >= dm ? s.lastModified : d.lastModified;
}

/**
 * Which side's content wins, or `conflict`.
 *
 * `--prefer store|disk` is absolute: the operator has said which side is
 * right, and that is the whole point of the flag. Otherwise the base decides
 * whether this is a one-sided edit (resolve by the newer clock) or a genuine
 * divergence (refuse).
 */
function chooseWinner(
  s: SyncEntry,
  d: SyncEntry,
  b: ManifestEntry | undefined,
  options: SyncOptions
): SyncSide | 'conflict' {
  if (options.prefer === 'store') return 'store';
  if (options.prefer === 'disk') return 'disk';

  if (b?.sha256) {
    const storeChanged = s.sha256 !== b.sha256;
    const diskChanged = d.sha256 !== b.sha256;
    if (storeChanged && diskChanged) return 'conflict';
    if (storeChanged) return 'store';
    if (diskChanged) return 'disk';
    // Neither matches the base yet both differ from each other: the base is
    // stale in a way that cannot be reconciled from here.
    return 'conflict';
  }

  // No base — a first run over a directory that already has content. The
  // clocks are all there is.
  const sm = timeOf(s.lastModified) ?? 0;
  const dm = timeOf(d.lastModified) ?? 0;
  if (Math.abs(sm - dm) <= MTIME_TOLERANCE_MS) return 'conflict';
  return sm > dm ? 'store' : 'disk';
}

/**
 * The sidecar half. Text documents are out of scope entirely — their
 * `description` has no disk home and is reported once as a `skip`.
 */
function planDescription(
  s: SyncEntry,
  d: SyncEntry,
  b: ManifestEntry | undefined,
  options: SyncOptions,
  sink: SyncAction[],
  warnings: string[]
): void {
  if (!hasSidecar(s.fileType)) {
    if ((s.description ?? '').length > 0) {
      sink.push(skipAction(s.relativePath, 'file', 'description on a text document is not synced'));
    }
    return;
  }

  const storeText = s.description ?? '';
  const diskText = d.description ?? '';
  const diskHasSidecar = d.description !== undefined;

  if (descriptionsEqual(storeText, diskText) && (diskHasSidecar || storeText.length === 0)) {
    return;
  }

  const baseSha = b?.descriptionSha256;
  const storeChanged = baseSha === undefined || descriptionSha256(storeText) !== baseSha;
  const diskChanged = baseSha === undefined || descriptionSha256(diskText) !== baseSha;

  // A sidecar the operator deleted while the store's caption stood still is a
  // deliberate clearing, not a conflict — but only the base can tell the two
  // apart, so with no base an absent sidecar simply takes the store's text.
  if (!diskHasSidecar) {
    if (baseSha !== undefined && !storeChanged && options.propagateDeletes) {
      push(sink, {
        kind: 'describe', side: 'store', relativePath: s.relativePath, entryKind: 'file',
        description: '', reason: 'sidecar deleted on disk (cleared)',
        linkId: s.linkId, outcome: 'planned',
      }, options);
    } else if (storeText.length > 0) {
      push(sink, {
        kind: 'describe', side: 'disk', relativePath: d.relativePath, entryKind: 'file',
        description: storeText, lastModified: s.descriptionUpdatedAt ?? s.lastModified,
        outcome: 'planned',
      }, options);
    }
    return;
  }

  if (options.prefer === 'store' || (options.prefer === 'newer' && storeChanged && !diskChanged)) {
    push(sink, {
      kind: 'describe', side: 'disk', relativePath: d.relativePath, entryKind: 'file',
      description: storeText, lastModified: s.descriptionUpdatedAt ?? s.lastModified,
      outcome: 'planned',
    }, options);
    return;
  }
  if (options.prefer === 'disk' || (options.prefer === 'newer' && diskChanged && !storeChanged)) {
    push(sink, {
      kind: 'describe', side: 'store', relativePath: s.relativePath, entryKind: 'file',
      description: diskText, lastModified: d.descriptionUpdatedAt ?? d.lastModified,
      linkId: s.linkId, outcome: 'planned',
    }, options);
    return;
  }

  // Both moved since the base (or there is no base and they simply differ):
  // fall back to the sidecar's own clock, and refuse when even that is a tie.
  const storeAt = timeOf(s.descriptionUpdatedAt) ?? timeOf(s.lastModified) ?? 0;
  const diskAt = timeOf(d.descriptionUpdatedAt) ?? timeOf(d.lastModified) ?? 0;
  if (baseSha !== undefined && storeChanged && diskChanged) {
    sink.push(conflictAction(
      s.relativePath, 'file',
      'the caption changed in the store and in the sidecar; --prefer to resolve'
    ));
    warnings.push(`Caption conflict on ${s.relativePath}`);
    return;
  }
  if (Math.abs(storeAt - diskAt) <= MTIME_TOLERANCE_MS) {
    sink.push(conflictAction(
      s.relativePath, 'file',
      'the caption differs and both sides carry the same clock; --prefer to resolve'
    ));
    return;
  }
  if (storeAt > diskAt) {
    push(sink, {
      kind: 'describe', side: 'disk', relativePath: d.relativePath, entryKind: 'file',
      description: storeText, lastModified: s.descriptionUpdatedAt ?? s.lastModified,
      outcome: 'planned',
    }, options);
  } else {
    push(sink, {
      kind: 'describe', side: 'store', relativePath: s.relativePath, entryKind: 'file',
      description: diskText, lastModified: d.descriptionUpdatedAt ?? d.lastModified,
      linkId: s.linkId, outcome: 'planned',
    }, options);
  }
}

/**
 * A store write repoints every member of the writer's hard-link group at the
 * new content row, so each sibling's disk copy is stale the instant this run
 * applies. Emit the second `modify disk` now, from the same bytes, so the run
 * converges without a second invocation.
 *
 * Two members of one group edited differently on disk in one run cannot both
 * win — the group is one file — so both are refused.
 */
function planGroupFanOut(
  store: SyncEntryMap,
  disk: SyncEntryMap,
  storeRewrites: Set<string>,
  options: SyncOptions,
  sink: SyncAction[],
  warnings: string[]
): void {
  if (storeRewrites.size === 0) return;

  const byGroup = new Map<string, string[]>();
  for (const [key, entry] of store) {
    if (!entry.linkGroupId) continue;
    const members = byGroup.get(entry.linkGroupId) ?? [];
    members.push(key);
    byGroup.set(entry.linkGroupId, members);
  }

  for (const [groupId, members] of byGroup) {
    const written = members.filter(m => storeRewrites.has(m));
    if (written.length === 0) continue;
    if (written.length > 1) {
      for (const key of written) {
        const entry = store.get(key)!;
        sink.push(conflictAction(
          entry.relativePath, 'file',
          `two members of one hard-link group changed differently on disk (group ${groupId.slice(0, 8)})`
        ));
      }
      warnings.push(`Hard-link group ${groupId.slice(0, 8)} was edited at more than one of its paths`);
      continue;
    }

    const source = store.get(written[0])!;
    for (const key of members) {
      if (key === written[0]) continue;
      const sibling = store.get(key);
      const onDisk = disk.get(key);
      if (!sibling || !onDisk) continue;
      // The sibling's store copy is about to become the written bytes; its
      // disk copy must follow, sourced from the path that actually changed.
      push(sink, {
        kind: 'modify', side: 'disk', relativePath: onDisk.relativePath, entryKind: 'file',
        reason: `hard-linked to ${source.relativePath}`,
        lastModified: source.lastModified,
        createdAt: olderCreatedAt(sibling.createdAt, onDisk.createdAt),
        linkId: sibling.linkId,
        outcome: 'planned',
      }, options);
    }
  }
}
