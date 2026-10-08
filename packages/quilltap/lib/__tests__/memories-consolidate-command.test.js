/**
 * `quilltap memories consolidate`: flag parsing, request body, report rendering.
 *
 * @jest-environment node
 */

'use strict';

const { parseFlags } = require('../memories-commands');
const { buildConsolidateBody, renderReport } = require('../memories-consolidate-command');

describe('memories consolidate flags', () => {
  it('parses verb, character, dry-run, max, threshold and port', () => {
    const { flags, positional } = parseFlags([
      'consolidate', '--instance', 'Friday', '--character', 'Friday',
      '--dry-run', '--max', '12', '--threshold', '0.8', '--port', '3005', '--json',
    ]);
    expect(positional).toEqual(['consolidate']);
    expect(flags).toMatchObject({
      instance: 'Friday', character: 'Friday', dryRun: true, max: 12, threshold: 0.8, port: 3005, json: true,
    });
  });

  it('defaults to a real run with no overrides', () => {
    const { flags } = parseFlags(['consolidate', '--character', 'X']);
    expect(flags.dryRun).toBe(false);
    expect(buildConsolidateBody('id', flags)).toEqual({ characterId: 'id', dryRun: false });
  });

  it('builds the request body from the flags', () => {
    const { flags } = parseFlags(['consolidate', '--dry-run', '--max', '5', '--threshold', '0.65']);
    expect(buildConsolidateBody('abc', flags)).toEqual({
      characterId: 'abc', dryRun: true, maxClustersPerRun: 5, clusterThreshold: 0.65,
    });
  });
});

describe('renderReport', () => {
  it('prints cluster, members and the proposed digest', () => {
    let out = '';
    renderReport({
      characterName: 'Ariadne', dryRun: true,
      clusters: [{
        bucket: { kind: 'other', subjectName: 'Calvin', subjectCharacterId: 'c' },
        clusterKind: 'semantic', status: 'planned',
        memberIds: ['aaaaaaaa-1', 'bbbbbbbb-2'], memberContents: ['Calvin likes tea', 'Calvin drinks tea daily'],
        keepStandalone: ['bbbbbbbb-2'], contradictions: [{ olderId: 'aaaaaaaa-1', newerId: 'bbbbbbbb-2', note: 'tea vs coffee' }],
        digests: [{ id: 'd1', action: 'create', content: 'Calvin is a devoted tea drinker', importance: 0.6, memberIds: ['aaaaaaaa-1'] }],
      }],
      stats: { candidates: 40, clustersFound: 3, clustersAttempted: 1, clustersDeferred: 2, durationMs: 1500 },
    }, (s) => { out += s; });
    expect(out).toContain('Ariadne');
    expect(out).toContain('about Calvin');
    expect(out).toContain('Calvin likes tea');
    expect(out).toContain('[kept standalone]');
    expect(out).toContain('Calvin is a devoted tea drinker');
    expect(out).toContain('tea vs coffee');
    expect(out).toContain('candidates 40');
  });

  it('reports a skipped run', () => {
    let out = '';
    renderReport({ dryRun: true, skippedReason: 'no-llm', clusters: [], stats: {} }, (s) => { out += s; });
    expect(out).toContain('Skipped: no-llm');
  });
});
