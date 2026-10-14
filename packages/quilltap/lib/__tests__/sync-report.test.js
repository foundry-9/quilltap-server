/**
 * How `quilltap sync` renders a plan.
 *
 * The formatter is the operator's whole view of what the verb did, and its
 * two load-bearing claims are easy to get subtly wrong: the second column is
 * the side that CHANGES (so `modify store` means the store is rewritten from
 * disk, not the other way round), and the exit code distinguishes "an
 * unresolved conflict" from "something failed" so a script can tell them apart.
 *
 * @jest-environment node
 */

'use strict';

const {
  formatActionLine,
  formatActionLines,
  formatSummary,
  exitCodeFor,
  displayPath,
  formatBytes,
} = require('../sync-report');

function action(over = {}) {
  return { kind: 'create', side: 'disk', relativePath: 'a.md', entryKind: 'file', ...over };
}

function summary(over = {}) {
  return {
    created: 0, modified: 0, deleted: 0, touched: 0,
    described: 0, conflicts: 0, skipped: 0, failed: 0, ...over,
  };
}

describe('one action, one line', () => {
  it('puts the action first and the side that changes second', () => {
    expect(formatActionLine(action({ kind: 'modify', side: 'store', relativePath: 'ch.md' }), false))
      .toBe('modify   store  ch.md');
  });

  it('pads the columns so paths line up under each other', () => {
    const lines = formatActionLines([
      action({ kind: 'mkdir', side: 'disk', relativePath: 'lore', entryKind: 'folder' }),
      action({ kind: 'conflict', side: null, relativePath: 'ch.md' }),
    ], false);
    const column = lines.map((l) => l.indexOf(l.trim().split(/\s+/)[2] || ''));
    expect(new Set(column).size).toBe(1);
  });

  it('marks a folder with a trailing slash so it cannot be mistaken for a file', () => {
    expect(displayPath(action({ entryKind: 'folder', relativePath: 'drafts' }))).toBe('drafts/');
    expect(displayPath(action({ entryKind: 'file', relativePath: 'drafts' }))).toBe('drafts');
  });

  it('writes an em dash where no side changes', () => {
    expect(formatActionLine(action({ kind: 'conflict', side: null }), false))
      .toContain('conflict —');
  });

  it('appends the engine’s reason in parentheses', () => {
    expect(formatActionLine(action({ kind: 'modify', side: 'store', reason: 'disk newer by 2h 14m' }), false))
      .toContain('(disk newer by 2h 14m)');
  });

  it('shows the sha and size on a line that moved bytes', () => {
    const line = formatActionLine(
      action({ sha256: '3f9a' + '0'.repeat(60), sizeBytes: 421888 }), false
    );
    expect(line).toContain('sha 3f9a…');
    expect(line).toContain('412.0 KB');
  });

  it('says nothing about bytes on a delete', () => {
    expect(formatActionLine(action({ kind: 'delete', side: 'store', sha256: 'x'.repeat(64) }), false))
      .not.toContain('sha');
  });

  it('leads with the error when an action failed', () => {
    const line = formatActionLine(
      action({ outcome: 'failed', error: 'EACCES', reason: 'store newer' }), false
    );
    expect(line).toContain('FAILED: EACCES');
    expect(line).not.toContain('store newer');
  });

  it('emits no escape codes when colour is off', () => {
    const lines = formatActionLines(
      [action(), action({ kind: 'conflict', side: null }), action({ kind: 'delete', side: 'store' })],
      false
    );
    expect(lines.join('\n')).not.toMatch(/\x1b\[/);
  });

  it('tints the line when colour is on', () => {
    expect(formatActionLine(action({ kind: 'conflict', side: null }), true)).toMatch(/\x1b\[31m/);
  });

  it('caps the path column so one long path does not push every detail off screen', () => {
    const lines = formatActionLines([
      action({ relativePath: 'a/'.repeat(60) + 'deep.md', reason: 'why' }),
      action({ relativePath: 'b.md', reason: 'why' }),
    ], false);
    expect(lines[1].indexOf('(why)')).toBeLessThan(80);
  });
});

describe('the summary', () => {
  it('names only the categories that actually happened', () => {
    expect(formatSummary(summary({ created: 3, modified: 1 }), 800, false))
      .toBe('3 created, 1 modified — 0.8 s');
  });

  it('says so plainly when there was nothing to do', () => {
    expect(formatSummary(summary(), 120, false)).toBe('Already in step — 0.1 s');
  });

  it('speaks in the conditional under --dry-run', () => {
    expect(formatSummary(summary({ created: 2 }), 300, true)).toBe('Would do: 2 created — 0.3 s');
    expect(formatSummary(summary(), 300, true)).toBe('Nothing to do — 0.3 s');
  });

  it('pluralises conflicts', () => {
    expect(formatSummary(summary({ conflicts: 1 }), 0, false)).toContain('1 conflict —');
    expect(formatSummary(summary({ conflicts: 2 }), 0, false)).toContain('2 conflicts');
  });

  it('reports failures last, where they are hardest to miss', () => {
    const line = formatSummary(summary({ created: 1, failed: 2 }), 0, false);
    expect(line.indexOf('2 failed')).toBeGreaterThan(line.indexOf('1 created'));
  });
});

describe('the exit code', () => {
  it('is 0 when the run was clean', () => {
    expect(exitCodeFor(summary({ created: 5, touched: 2 }))).toBe(0);
  });

  it('is 2 for an unresolved conflict', () => {
    expect(exitCodeFor(summary({ conflicts: 1 }))).toBe(2);
  });

  it('is 1 when something failed outright, even alongside a conflict', () => {
    expect(exitCodeFor(summary({ conflicts: 1, failed: 1 }))).toBe(1);
  });
});

describe('byte formatting', () => {
  it('scales through the units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.00 GB');
  });

  it('says nothing for a size it was not given', () => {
    expect(formatBytes(undefined)).toBe('');
  });
});
