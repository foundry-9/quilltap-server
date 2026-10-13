/**
 * `quilltap memories maintain` and `validate --repair`: flag parsing, phase
 * validation, request bodies, report rendering, and the integrity scan.
 *
 * @jest-environment node
 */

'use strict';

const { parseFlags, renderRepairText } = require('../memories-commands');
const {
  MAINTENANCE_PHASES,
  parsePhases,
  buildMaintainBody,
  renderMaintenanceReport,
  renderReportsTable,
} = require('../memories-maintain-command');
const { scanDigestIntegrity } = require('../graph-integrity');

const ID = '11111111-2222-3333-4444-555555555555';

describe('memories maintain flags', () => {
  it('parses verb, character, phases, dry-run, max, threshold, cap and port', () => {
    const { flags, positional } = parseFlags([
      'maintain', '--instance', 'Friday', '--character', 'Friday', '--phases', 'consolidate,demote',
      '--dry-run', '--max', '12', '--threshold', '0.8', '--cap', '500', '--port', '3005', '--json',
    ]);
    expect(positional).toEqual(['maintain']);
    expect(flags).toMatchObject({
      instance: 'Friday', character: 'Friday', phases: 'consolidate,demote', dryRun: true,
      max: 12, threshold: 0.8, cap: 500, port: 3005, json: true,
    });
  });

  it('leaves the port undefined so the instance lock can supply it', () => {
    expect(parseFlags(['maintain', '--character', 'X']).flags.port).toBeUndefined();
    expect(parseFlags(['maintain', '-p', '3007']).flags.port).toBe(3007);
  });

  it('parses --repair and --write for validate', () => {
    const { flags } = parseFlags(['validate', '--repair', '--write']);
    expect(flags).toMatchObject({ repair: true, write: true });
  });
});

describe('parsePhases', () => {
  it('returns null for every phase', () => {
    expect(parsePhases('')).toBeNull();
    expect(parsePhases(undefined)).toBeNull();
  });

  it('puts the phases in run order and drops duplicates', () => {
    expect(parsePhases('mirror, demote,fold-near-duplicates,demote')).toEqual(['fold-near-duplicates', 'demote', 'mirror']);
  });

  it('refuses an unknown phase, naming the valid ones', () => {
    expect(() => parsePhases('consolidate,housekeep')).toThrow(/Unknown maintenance phase: housekeep.*fold-near-duplicates/);
  });

  it('knows the five phases', () => {
    expect(MAINTENANCE_PHASES).toEqual(['fold-near-duplicates', 'consolidate', 'demote', 'retire', 'mirror']);
  });
});

describe('buildMaintainBody', () => {
  it('defaults to a real run of every phase with no overrides', () => {
    const { flags } = parseFlags(['maintain', '--character', 'X']);
    expect(buildMaintainBody(ID, flags)).toEqual({ characterId: ID, dryRun: false });
  });

  it('maps the knobs onto settings', () => {
    const { flags } = parseFlags([
      'maintain', '--dry-run', '--phases', 'consolidate', '--max', '5', '--threshold', '0.65', '--cap', '300',
    ]);
    expect(buildMaintainBody(ID, flags)).toEqual({
      characterId: ID,
      dryRun: true,
      phases: ['consolidate'],
      settings: { maxClustersPerRun: 5, consolidation: { clusterThreshold: 0.65 }, cap: 300 },
    });
  });

  it('omits characterId for a user-wide run', () => {
    const { flags } = parseFlags(['maintain', '--character', 'all']);
    expect(buildMaintainBody(null, flags)).toEqual({ dryRun: false });
  });

  it('allows a user-wide dry run of the model-free phases', () => {
    const { flags } = parseFlags(['maintain', '--dry-run', '--phases', 'demote,retire']);
    expect(buildMaintainBody(null, flags)).toEqual({ dryRun: true, phases: ['demote', 'retire'] });
  });

  it('refuses a user-wide dry run that would consolidate', () => {
    const all = parseFlags(['maintain', '--dry-run']).flags;
    expect(() => buildMaintainBody(null, all)).toThrow(/cannot include consolidation/);
    const named = parseFlags(['maintain', '--dry-run', '--phases', 'consolidate']).flags;
    expect(() => buildMaintainBody(null, named)).toThrow(/cannot include consolidation/);
  });

  it('refuses a cap or max the server would refuse', () => {
    expect(() => buildMaintainBody(ID, parseFlags(['maintain', '--cap', '50']).flags)).toThrow(/--cap/);
    expect(() => buildMaintainBody(ID, parseFlags(['maintain', '--max', '5000']).flags)).toThrow(/--max/);
  });
});

describe('renderMaintenanceReport', () => {
  function capture(fn) {
    let out = '';
    fn((s) => { out += s; });
    return out.replace(/\x1b\[[0-9;]*m/g, '');
  }

  it('prints phase lines and every phase detail', () => {
    const out = capture((write) => renderMaintenanceReport({
      characterId: ID, characterName: 'Ariadne', dryRun: true, durationMs: 2500,
      phases: [
        { phase: 'fold-near-duplicates', status: 'ran', durationMs: 10 },
        { phase: 'consolidate', status: 'ran', durationMs: 2000 },
        { phase: 'demote', status: 'ran', durationMs: 5 },
        { phase: 'retire', status: 'skipped', skippedBecause: 'no-retention-window', durationMs: 0 },
        { phase: 'mirror', status: 'ran', durationMs: 3 },
      ],
      fold: {
        eligible: 80, deferred: 0, groupsDeferred: 0, folded: 2, groupsFailed: 0,
        groups: [{ survivorId: 'aaaaaaaa-1', absorbedIds: ['bbbbbbbb-2', 'cccccccc-3'], minCosine: 0.97 }],
      },
      consolidation: {
        dryRun: true,
        clusters: [{
          bucket: { kind: 'other', subjectName: 'Calvin', subjectCharacterId: 'c' },
          clusterKind: 'semantic', status: 'planned',
          memberIds: ['aaaaaaaa-1', 'bbbbbbbb-2'], memberContents: ['Calvin likes tea', 'Calvin drinks tea daily'],
          keepStandalone: ['bbbbbbbb-2'], contradictions: [{ olderId: 'aaaaaaaa-1', newerId: 'bbbbbbbb-2', note: 'tea vs coffee' }],
          digests: [{ id: 'd1', action: 'create', content: 'Calvin is a devoted tea drinker', importance: 0.6, memberIds: ['aaaaaaaa-1'] }],
        }],
        stats: { candidates: 40, clustersFound: 3, clustersAttempted: 1, clustersDeferred: 2, durationMs: 1500 },
      },
      demote: {
        cap: 1000, hotTotal: 1300, demotable: 1200, protected: 100, excess: 200, demoted: 200,
        demotedIds: [], highestScoreDemoted: 0.4,
      },
      mirror: { subjects: ['self', 'Calvin'], filesWritten: 0, deferredToCommit: false },
    }, write));
    expect(out).toContain('Maintenance dry run');
    expect(out).toContain('Ariadne');
    expect(out).toContain('no-retention-window');
    expect(out).toContain('aaaaaaaa <=');
    expect(out).toContain('folded 2');
    expect(out).toContain('about Calvin');
    expect(out).toContain('Calvin likes tea');
    expect(out).toContain('[kept standalone]');
    expect(out).toContain('Calvin is a devoted tea drinker');
    expect(out).toContain('tea vs coffee');
    expect(out).toContain('candidates 40');
    expect(out).toContain('cap 1000');
    expect(out).toContain('demotable 1200');
    expect(out).toContain('excess 200');
    expect(out).toContain('self, Calvin');
  });

  it('reports a skipped run', () => {
    const out = capture((write) => renderMaintenanceReport({
      characterId: ID, characterName: null, dryRun: true, skippedReason: 'archived', phases: [],
    }, write));
    expect(out).toContain('Skipped: archived');
  });

  it('reports a skipped consolidation', () => {
    const out = capture((write) => renderMaintenanceReport({
      characterId: ID, characterName: 'A', dryRun: true, phases: [],
      consolidation: { dryRun: true, skippedReason: 'no-llm', clusters: [], stats: {} },
    }, write));
    expect(out).toContain('Skipped: no-llm');
  });
});

describe('renderReportsTable', () => {
  it('prints one row per character', () => {
    let out = '';
    renderReportsTable([
      {
        characterId: ID, characterName: 'Ariadne', dryRun: true,
        phases: [{ phase: 'demote', status: 'ran', durationMs: 1 }, { phase: 'retire', status: 'ran', durationMs: 1 }],
        demote: { cap: 1000, hotTotal: 10, demotable: 10, protected: 0, excess: 0, demoted: 0, demotedIds: [], highestScoreDemoted: null },
        retire: { retentionDays: 90, retired: 3, retiredIds: [] },
      },
      { characterId: 'ffffffff-0', characterName: null, dryRun: true, skippedReason: 'archived', phases: [] },
    ], (s) => { out += s; });
    out = out.replace(/\x1b\[[0-9;]*m/g, '');
    expect(out).toContain('across 2 characters');
    expect(out).toMatch(/Ariadne\s+demote,retire\s+-\s+10\/1000 -0\s+3/);
    expect(out).toContain('ffffffff');
    expect(out).toContain('skipped: archived');
  });
});

describe('scanDigestIntegrity', () => {
  // better-sqlite3 is mocked under jest, so drive the scanner with a fake
  // that answers the handful of queries it issues.
  function fakeDb(rows, columns) {
    const has = new Set(columns);
    const scoped = (sql, params) => (sql.includes('characterId = ?') ? rows.filter((r) => r.characterId === params[0]) : rows);
    return {
      prepare(sql) {
        return {
          all: (...params) => {
            if (sql.startsWith('PRAGMA')) return [...has].map((name) => ({ name }));
            if (sql.trim() === 'SELECT id FROM memories') return rows.map((r) => ({ id: r.id }));
            if (sql.includes('consolidatedFrom FROM')) {
              return scoped(sql, params).filter((r) => r.consolidatedFrom && r.consolidatedFrom !== '[]');
            }
            if (sql.includes('supersededById FROM')) return scoped(sql, params).filter((r) => r.supersededById != null);
            throw new Error(`unexpected query: ${sql}`);
          },
          get: (...params) => {
            if (sql.includes('embedding IS NULL')) return { n: scoped(sql, params).filter((r) => r.embedding == null).length };
            throw new Error(`unexpected query: ${sql}`);
          },
        };
      },
    };
  }

  const ALL_COLUMNS = ['id', 'characterId', 'relatedMemoryIds', 'consolidatedFrom', 'supersededById', 'embedding'];

  it('counts dangling digest members, dangling supersededById and missing embeddings', () => {
    const db = fakeDb([
      { id: 'digest', characterId: 'c1', consolidatedFrom: JSON.stringify(['m1', 'gone1', 'gone2']), supersededById: null, embedding: 'x' },
      { id: 'm1', characterId: 'c1', consolidatedFrom: '[]', supersededById: 'digest', embedding: 'x' },
      { id: 'm2', characterId: 'c1', consolidatedFrom: '[]', supersededById: 'gone-digest', embedding: null },
      { id: 'other', characterId: 'c2', consolidatedFrom: JSON.stringify(['gone3']), supersededById: null, embedding: null },
    ], ALL_COLUMNS);

    const one = scanDigestIntegrity(db, { characterId: 'c1', includePairs: true });
    expect(one.consolidatedFrom).toEqual({ links: 2, digests: 1 });
    expect(one.supersededBy).toBe(1);
    expect(one.missingEmbeddings).toBe(1);
    expect(one.consolidatedFromPairs).toEqual([{ digestId: 'digest', characterId: 'c1', memberIds: ['gone1', 'gone2'] }]);
    expect(one.supersededByPairs).toEqual([{ memberId: 'm2', characterId: 'c1', digestId: 'gone-digest' }]);

    const all = scanDigestIntegrity(db);
    expect(all.consolidatedFrom).toEqual({ links: 3, digests: 2 });
    expect(all.missingEmbeddings).toBe(2);
  });

  it('reads an instance without the tier-era columns as nothing to scan', () => {
    const db = fakeDb([{ id: 'm1', characterId: 'c1', embedding: null }], ['id', 'characterId', 'relatedMemoryIds', 'embedding']);
    expect(scanDigestIntegrity(db)).toEqual({
      consolidatedFrom: { links: 0, digests: 0 }, supersededBy: 0, missingEmbeddings: 1,
    });
  });
});

describe('renderRepairText', () => {
  function captureLog(fn) {
    const lines = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((...args) => { lines.push(args.join(' ')); });
    try { fn(); } finally { spy.mockRestore(); }
    return lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
  }
  const found = {
    related: { links: 3, rows: 2 }, consolidatedFrom: { links: 1, digests: 1 }, supersededBy: 2, missingEmbeddings: 4,
  };

  it('prints a dry run with the --write hint', () => {
    const out = captureLog(() => renderRepairText({ dryRun: true, characterId: null, found }));
    expect(out).toContain('dry run, every memory');
    expect(out).toContain('3 dangling related link(s) on 2 row(s)');
    expect(out).toContain('1 dangling consolidatedFrom member(s) on 1 digest(s)');
    expect(out).toContain('2 dangling supersededById');
    expect(out).toContain('4 row(s) without an embedding');
    expect(out).toContain('Add --write');
  });

  it('prints the repaired counts and a skipped embedding pass', () => {
    const out = captureLog(() => renderRepairText({
      dryRun: false, characterId: ID, found,
      repaired: {
        relatedRowsTouched: 2, digestsTouched: 1, membersCut: 2, charactersAffected: 1,
        embeddingJobsQueued: 0, embeddingSkippedReason: 'no-embedding-profile',
      },
    }));
    expect(out).toContain('(applied)');
    expect(out).toContain('2 row(s) relinked, 1 digest(s) touched, 2 member(s) cut loose');
    expect(out).toContain('0 embedding job(s) queued');
    expect(out).toContain('no-embedding-profile');
    expect(out).not.toContain('Add --write');
  });
});
