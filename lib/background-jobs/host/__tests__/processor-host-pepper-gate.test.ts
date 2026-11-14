/**
 * The job child cannot run without the encryption pepper, and it inherits the
 * pepper from the parent's environment at fork time. On a brand-new instance
 * jobs are enqueued before first-run setup has produced one; forking then made
 * the child exit 1 five times, spent the restart budget, and left
 * `childCrashed` set for the life of the process — no background jobs until a
 * restart. The host now defers the fork until the pepper exists, without
 * spending the crash budget, and spawns as soon as it is woken after setup.
 */

import { EventEmitter } from 'events';
import { ensureProcessorRunning, getProcessorStatus, stopProcessor } from '../processor-host';
import { startDispatcher, dispatcherWake } from '../job-dispatcher';

const mockFork = jest.fn();
jest.mock('node:module', () => ({
  createRequire: () => () => ({ fork: (...args: unknown[]) => mockFork(...args) }),
}));
jest.mock('../job-dispatcher', () => ({
  startDispatcher: jest.fn(),
  stopDispatcher: jest.fn(),
  dispatcherWake: jest.fn(),
  getDispatcherSnapshot: jest.fn(() => ({ inFlight: 0 })),
  handleChildJobResult: jest.fn(),
}));
jest.mock('../host-rpc-dispatcher', () => ({ dispatchHostRpc: jest.fn() }));
jest.mock('../../activity-registry', () => ({
  applyChildActivityDelta: jest.fn(),
  resetChildActivity: jest.fn(),
}));
jest.mock('fs', () => ({
  __esModule: true,
  default: { existsSync: () => true },
  existsSync: () => true,
}));

function fakeChild(): EventEmitter & { killed: boolean; send: jest.Mock; kill: jest.Mock } {
  const child = new EventEmitter() as EventEmitter & { killed: boolean; send: jest.Mock; kill: jest.Mock };
  child.killed = false;
  child.send = jest.fn();
  child.kill = jest.fn(() => {
    child.killed = true;
    return true;
  });
  return child;
}

describe('processor host: encryption pepper gate', () => {
  const savedPepper = process.env.ENCRYPTION_MASTER_PEPPER;

  beforeEach(() => {
    jest.clearAllMocks();
    globalThis.__quilltapJobHost = undefined;
    mockFork.mockImplementation(() => fakeChild());
  });

  afterEach(() => {
    stopProcessor();
    if (savedPepper === undefined) delete process.env.ENCRYPTION_MASTER_PEPPER;
    else process.env.ENCRYPTION_MASTER_PEPPER = savedPepper;
  });

  it('does not fork the child while there is no pepper', () => {
    delete process.env.ENCRYPTION_MASTER_PEPPER;

    ensureProcessorRunning();
    ensureProcessorRunning();

    expect(mockFork).not.toHaveBeenCalled();
    expect(startDispatcher).not.toHaveBeenCalled();
    expect(getProcessorStatus()).toMatchObject({ running: false, childCrashed: false });
  });

  it('forks and starts dispatching once the pepper arrives', () => {
    delete process.env.ENCRYPTION_MASTER_PEPPER;
    ensureProcessorRunning();
    expect(mockFork).not.toHaveBeenCalled();

    process.env.ENCRYPTION_MASTER_PEPPER = 'test-pepper';
    ensureProcessorRunning();

    expect(mockFork).toHaveBeenCalledTimes(1);
    expect(startDispatcher).toHaveBeenCalledTimes(1);
    expect(dispatcherWake).toHaveBeenCalled();
    expect(getProcessorStatus()).toMatchObject({ running: true, childCrashed: false });
  });

  it('does not respawn a crashed child while the pepper is gone, and spends no crash budget doing so', () => {
    jest.useFakeTimers();
    try {
      process.env.ENCRYPTION_MASTER_PEPPER = 'test-pepper';
      const child = fakeChild();
      mockFork.mockImplementationOnce(() => child);
      ensureProcessorRunning();
      expect(mockFork).toHaveBeenCalledTimes(1);

      delete process.env.ENCRYPTION_MASTER_PEPPER;
      child.emit('exit', 1, null);
      jest.runOnlyPendingTimers();

      expect(mockFork).toHaveBeenCalledTimes(1);
      expect(getProcessorStatus().childCrashed).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
