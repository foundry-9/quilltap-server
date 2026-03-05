/**
 * Async Process Registry Tests
 *
 * Tests for the in-memory process tracking system.
 */

import {
  registerProcess,
  getProcessStatus,
  killProcess,
  hasProcess,
  getProcessCount,
  clearAllProcesses,
} from '@/lib/tools/shell/async-process-registry';
import { EventEmitter } from 'events';

// Mock ChildProcess
function createMockProcess(): any {
  const mock = new EventEmitter();
  (mock as any).stdout = new EventEmitter();
  (mock as any).stderr = new EventEmitter();
  (mock as any).pid = Math.floor(Math.random() * 100000);
  (mock as any).kill = jest.fn(() => {
    mock.emit('exit', null);
  });
  return mock;
}

describe('AsyncProcessRegistry', () => {
  beforeEach(() => {
    clearAllProcesses();
  });

  describe('registerProcess', () => {
    it('should register a process', () => {
      const mockProcess = createMockProcess();
      registerProcess(1234, mockProcess, 'echo hello');
      expect(hasProcess(1234)).toBe(true);
      expect(getProcessCount()).toBe(1);
    });

    it('should capture stdout', () => {
      const mockProcess = createMockProcess();
      registerProcess(1234, mockProcess, 'echo hello');

      mockProcess.stdout.emit('data', Buffer.from('hello\n'));

      const status = getProcessStatus(1234);
      expect(status?.stdout).toBe('hello\n');
    });

    it('should capture stderr', () => {
      const mockProcess = createMockProcess();
      registerProcess(1234, mockProcess, 'echo hello');

      mockProcess.stderr.emit('data', Buffer.from('warning\n'));

      const status = getProcessStatus(1234);
      expect(status?.stderr).toBe('warning\n');
    });

    it('should mark status as complete on exit', () => {
      const mockProcess = createMockProcess();
      registerProcess(1234, mockProcess, 'echo hello');

      mockProcess.emit('exit', 0);

      const status = getProcessStatus(1234);
      expect(status?.status).toBe('complete');
      expect(status?.exitCode).toBe(0);
      expect(status?.completedAt).toBeDefined();
    });

    it('should handle null exit code', () => {
      const mockProcess = createMockProcess();
      registerProcess(1234, mockProcess, 'echo hello');

      mockProcess.emit('exit', null);

      const status = getProcessStatus(1234);
      expect(status?.exitCode).toBe(1);
    });

    it('should handle process errors', () => {
      const mockProcess = createMockProcess();
      registerProcess(1234, mockProcess, 'badcommand');

      mockProcess.emit('error', new Error('ENOENT'));

      const status = getProcessStatus(1234);
      expect(status?.status).toBe('complete');
      expect(status?.exitCode).toBe(1);
      expect(status?.stderr).toContain('ENOENT');
    });
  });

  describe('getProcessStatus', () => {
    it('should return null for unknown PIDs', () => {
      expect(getProcessStatus(99999)).toBeNull();
    });

    it('should return correct initial state', () => {
      const mockProcess = createMockProcess();
      registerProcess(5678, mockProcess, 'sleep 10');

      const status = getProcessStatus(5678);
      expect(status).not.toBeNull();
      expect(status!.pid).toBe(5678);
      expect(status!.command).toBe('sleep 10');
      expect(status!.status).toBe('running');
      expect(status!.startedAt).toBeDefined();
    });
  });

  describe('killProcess', () => {
    it('should kill a running process', () => {
      const mockProcess = createMockProcess();
      registerProcess(1111, mockProcess, 'sleep 100');

      const killed = killProcess(1111);
      expect(killed).toBe(true);
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should return false for non-existent process', () => {
      expect(killProcess(99999)).toBe(false);
    });

    it('should return false for already completed process', () => {
      const mockProcess = createMockProcess();
      registerProcess(2222, mockProcess, 'echo done');
      mockProcess.emit('exit', 0);

      expect(killProcess(2222)).toBe(false);
    });
  });

  describe('hasProcess', () => {
    it('should return true for tracked processes', () => {
      const mockProcess = createMockProcess();
      registerProcess(3333, mockProcess, 'test');
      expect(hasProcess(3333)).toBe(true);
    });

    it('should return false for untracked processes', () => {
      expect(hasProcess(44444)).toBe(false);
    });
  });

  describe('clearAllProcesses', () => {
    it('should clear all tracked processes', () => {
      const mock1 = createMockProcess();
      const mock2 = createMockProcess();
      registerProcess(1, mock1, 'cmd1');
      registerProcess(2, mock2, 'cmd2');

      expect(getProcessCount()).toBe(2);
      clearAllProcesses();
      expect(getProcessCount()).toBe(0);
    });
  });
});
