/**
 * The autonomous-run AsyncLocalStorage context tags llm_logs rows with the
 * run that produced them. These tests pin its propagation contract: the id is
 * visible to synchronous and awaited work inside the wrapped call, null
 * outside, and correctly restored when contexts nest.
 */

import {
  runWithAutonomousRunId,
  getAutonomousRunId,
} from '@/lib/background-jobs/autonomous-run-context';

describe('autonomous-run-context', () => {
  it('returns null outside any run scope', () => {
    expect(getAutonomousRunId()).toBeNull();
  });

  it('exposes the run id to code running inside the scope', async () => {
    const seen = await runWithAutonomousRunId('run-abc', async () => {
      return getAutonomousRunId();
    });
    expect(seen).toBe('run-abc');
  });

  it('propagates across awaited async work', async () => {
    const seen = await runWithAutonomousRunId('run-xyz', async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      return getAutonomousRunId();
    });
    expect(seen).toBe('run-xyz');
  });

  it('restores the outer id after a nested scope returns', async () => {
    await runWithAutonomousRunId('outer', async () => {
      expect(getAutonomousRunId()).toBe('outer');
      await runWithAutonomousRunId('inner', async () => {
        expect(getAutonomousRunId()).toBe('inner');
      });
      expect(getAutonomousRunId()).toBe('outer');
    });
  });

  it('does not leak the id after the scope ends', async () => {
    await runWithAutonomousRunId('run-1', async () => undefined);
    expect(getAutonomousRunId()).toBeNull();
  });
});
