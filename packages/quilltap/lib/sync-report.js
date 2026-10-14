'use strict';

/**
 * Rendering for `quilltap sync`.
 *
 * Deliberately pure — actions and a colour switch in, lines out — so the
 * report's shape can be tested without a server, a store, or a directory, the
 * way `docker-mounts` is.
 *
 * ## The shape of a line
 *
 *     modify   store  chapters/03.md                (disk newer by 2h 14m)
 *     ^        ^      ^                             ^
 *     action   side   path                          why
 *
 * The first two columns are fixed width so the paths line up under each other,
 * because the thing an operator actually reads down is the path column. The
 * side is the side that CHANGES: `modify store` means the store is rewritten
 * from disk, which is the opposite of the intuition some people bring and so
 * is worth being unambiguous about.
 *
 * Advisory text — warnings, the summary — goes to stderr in the caller, so
 * stdout stays greppable.
 *
 * @module sync-report
 */

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';

/** Column widths. `conflict` is the longest action word at 8. */
const ACTION_WIDTH = 8;
const SIDE_WIDTH = 6;

/** Which colour an action's line takes. */
const ACTION_COLOURS = {
  create: GREEN,
  mkdir: GREEN,
  modify: GREEN,
  describe: GREEN,
  delete: YELLOW,
  rmdir: YELLOW,
  touch: DIM,
  skip: DIM,
  conflict: RED,
};

function pad(text, width) {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function formatBytes(n) {
  if (n === undefined || n === null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * The parenthetical after a path: whatever the engine said, plus the sha and
 * size on a line that put bytes somewhere.
 */
function detailFor(action) {
  const parts = [];
  if (action.outcome === 'failed' && action.error) {
    parts.push(`FAILED: ${action.error}`);
  } else if (action.reason) {
    parts.push(action.reason);
  }
  if ((action.kind === 'create' || action.kind === 'modify') && action.sha256) {
    const size = formatBytes(action.sizeBytes);
    parts.push(`sha ${action.sha256.slice(0, 4)}…${size ? `, ${size}` : ''}`);
  }
  return parts.join('; ');
}

/**
 * A trailing slash marks a folder, so `drafts/` and a file called `drafts`
 * are not the same line.
 */
function displayPath(action) {
  return action.entryKind === 'folder' ? `${action.relativePath}/` : action.relativePath;
}

/**
 * One line per action.
 *
 * `pathWidth` aligns the parenthetical into a column of its own; the caller
 * computes it once across the whole plan, so a single very long path does not
 * push every other line's detail off the screen — it is capped.
 */
function formatActionLine(action, colour, pathWidth = 0) {
  const tint = colour
    ? (action.outcome === 'failed' ? RED : ACTION_COLOURS[action.kind] || '')
    : '';
  const reset = tint ? RESET : '';
  const side = action.side || '—';
  const detail = detailFor(action);
  const shownPath = detail ? pad(displayPath(action), pathWidth) : displayPath(action);
  const head = `${tint}${pad(action.kind, ACTION_WIDTH)}${reset} ${pad(side, SIDE_WIDTH)} ${shownPath}`;
  if (!detail) return head;
  return colour ? `${head}  ${DIM}(${detail})${RESET}` : `${head}  (${detail})`;
}

/** Longest path that carries a detail, capped so one outlier cannot ruin the column. */
const MAX_PATH_COLUMN = 44;

function formatActionLines(actions, colour) {
  const pathWidth = Math.min(
    MAX_PATH_COLUMN,
    actions.reduce(
      (widest, action) => (detailFor(action) ? Math.max(widest, displayPath(action).length) : widest),
      0
    )
  );
  return actions.map((action) => formatActionLine(action, colour, pathWidth));
}

/** `3 created, 1 modified, … — 0.8 s`, or a plain "nothing to do". */
function formatSummary(summary, elapsedMs, dryRun) {
  const bits = [];
  if (summary.created) bits.push(`${summary.created} created`);
  if (summary.modified) bits.push(`${summary.modified} modified`);
  if (summary.deleted) bits.push(`${summary.deleted} deleted`);
  if (summary.touched) bits.push(`${summary.touched} touched`);
  if (summary.described) bits.push(`${summary.described} described`);
  if (summary.skipped) bits.push(`${summary.skipped} skipped`);
  if (summary.conflicts) bits.push(`${summary.conflicts} conflict${summary.conflicts === 1 ? '' : 's'}`);
  if (summary.failed) bits.push(`${summary.failed} failed`);

  const seconds = `${(elapsedMs / 1000).toFixed(1)} s`;
  const prefix = dryRun ? 'Would do: ' : '';
  if (bits.length === 0) {
    return dryRun ? `Nothing to do — ${seconds}` : `Already in step — ${seconds}`;
  }
  return `${prefix}${bits.join(', ')} — ${seconds}`;
}

/**
 * The process exit code a report earns.
 *
 *   0  clean
 *   1  something failed outright
 *   2  at least one conflict is still unresolved
 *
 * `--dry-run` uses the same codes, so a script can gate on a clean plan before
 * it lets a real run proceed.
 */
function exitCodeFor(summary) {
  if (summary.failed > 0) return 1;
  if (summary.conflicts > 0) return 2;
  return 0;
}

module.exports = {
  formatActionLine,
  formatActionLines,
  formatSummary,
  exitCodeFor,
  detailFor,
  displayPath,
  formatBytes,
};
