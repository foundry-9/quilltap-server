/**
 * Shell Handler Tests
 *
 * Tests for shell tool execution handlers including environment guards,
 * path traversal rejection, timeout clamping, and dispatch logic.
 */

import { executeShellTool, executeSudoCommand, ShellError } from '@/lib/tools/shell/shell-handler';
import type { ShellToolContext } from '@/lib/tools/shell/shell-session.types';

// Mock dependencies
jest.mock('@/lib/paths', () => ({
  isShellEnvironment: jest.fn(() => true),
  getWorkspaceDir: jest.fn(() => '/data/quilltap/workspace'),
  getWorkspaceChatDir: jest.fn((chatId: string) => `/data/quilltap/workspace/chats/${chatId}`),
  getWorkspaceProjectDir: jest.fn((projectId: string) => `/data/quilltap/workspace/projects/${projectId}`),
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(() => ({
    chats: {
      findById: jest.fn(async () => ({
        id: 'test-chat',
        state: JSON.stringify({ workspaceWarningAcknowledged: true }),
      })),
      update: jest.fn(async () => {}),
    },
    files: {
      findById: jest.fn(async () => null),
      create: jest.fn(async () => {}),
    },
  })),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(() => Buffer.from('text content')),
  copyFileSync: jest.fn(),
  chmodSync: jest.fn(),
  statSync: jest.fn(() => ({ mode: 0o644 })),
}));

jest.mock('child_process', () => ({
  spawnSync: jest.fn(() => ({
    status: 0,
    stdout: Buffer.from('hello\n'),
    stderr: Buffer.from(''),
    signal: null,
  })),
  spawn: jest.fn(() => {
    const EventEmitter = require('events');
    const mock = new EventEmitter();
    mock.stdout = new EventEmitter();
    mock.stderr = new EventEmitter();
    mock.pid = 12345;
    mock.kill = jest.fn();
    return mock;
  }),
}));

jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: {
    uploadFile: jest.fn(async () => ({ storageKey: 'uploads/test.txt' })),
    getBasePath: jest.fn(() => '/data/quilltap/files'),
  },
}));

jest.mock('@/lib/tools/shell/async-process-registry', () => ({
  registerProcess: jest.fn(),
  getProcessStatus: jest.fn(),
  hasProcess: jest.fn(() => false),
}));

const { isShellEnvironment } = require('@/lib/paths');
const { spawnSync } = require('child_process');
const { getRepositories } = require('@/lib/repositories/factory');

const baseContext: ShellToolContext = {
  chatId: 'test-chat-123',
  userId: 'test-user',
  projectId: null,
};

describe('Shell Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-set defaults
    (isShellEnvironment as jest.Mock).mockReturnValue(true);
    (getRepositories as jest.Mock).mockReturnValue({
      chats: {
        findById: jest.fn(async () => ({
          id: 'test-chat-123',
          state: JSON.stringify({ workspaceWarningAcknowledged: true }),
        })),
        update: jest.fn(async () => {}),
      },
      files: {
        findById: jest.fn(async () => null),
        create: jest.fn(async () => {}),
      },
    });
  });

  describe('environment guard', () => {
    it('should reject execution when not in shell environment', async () => {
      (isShellEnvironment as jest.Mock).mockReturnValue(false);

      await expect(
        executeShellTool('exec_sync', { command: 'echo', parameters: ['hello'] }, baseContext)
      ).rejects.toThrow(ShellError);

      await expect(
        executeShellTool('exec_sync', { command: 'echo', parameters: ['hello'] }, baseContext)
      ).rejects.toThrow('Shell tools are only available');
    });

    it('should allow execution in shell environment', async () => {
      (isShellEnvironment as jest.Mock).mockReturnValue(true);

      const result = await executeShellTool(
        'exec_sync',
        { command: 'echo', parameters: ['hello'] },
        baseContext
      );

      expect(result.success).toBe(true);
    });
  });

  describe('workspace acknowledgement guard', () => {
    it('should require workspace acknowledgement before execution', async () => {
      (getRepositories as jest.Mock).mockReturnValue({
        chats: {
          findById: jest.fn(async () => ({
            id: 'test-chat-123',
            state: JSON.stringify({ workspaceWarningAcknowledged: false }),
          })),
          update: jest.fn(async () => {}),
        },
        files: {
          findById: jest.fn(async () => null),
          create: jest.fn(async () => {}),
        },
      });

      const result = await executeShellTool(
        'exec_sync',
        { command: 'echo', parameters: ['hello'] },
        baseContext
      );

      expect(result.requiresWorkspaceAcknowledgement).toBe(true);
      expect(result.success).toBe(false);
    });

    it('should require workspace acknowledgement when state is empty', async () => {
      (getRepositories as jest.Mock).mockReturnValue({
        chats: {
          findById: jest.fn(async () => ({
            id: 'test-chat-123',
            state: '{}',
          })),
          update: jest.fn(async () => {}),
        },
        files: {
          findById: jest.fn(async () => null),
          create: jest.fn(async () => {}),
        },
      });

      const result = await executeShellTool(
        'exec_sync',
        { command: 'echo', parameters: ['hello'] },
        baseContext
      );

      expect(result.requiresWorkspaceAcknowledgement).toBe(true);
    });
  });

  describe('exec_sync handler', () => {
    it('should execute a command and return result', async () => {
      const result = await executeShellTool(
        'exec_sync',
        { command: 'echo', parameters: ['hello'] },
        baseContext
      );

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect((result.result as any).exit_code).toBe(0);
      expect((result.result as any).stdout).toContain('hello');
    });

    it('should reject missing command', async () => {
      await expect(
        executeShellTool('exec_sync', {}, baseContext)
      ).rejects.toThrow('Command is required');
    });

    it('should clamp timeout to max (300000ms)', async () => {
      await executeShellTool(
        'exec_sync',
        { command: 'sleep', parameters: ['1'], timeout_ms: 999999 },
        baseContext
      );

      expect(spawnSync).toHaveBeenCalledWith(
        'sleep',
        ['1'],
        expect.objectContaining({
          timeout: 300000,
        })
      );
    });

    it('should use default timeout when not specified', async () => {
      await executeShellTool(
        'exec_sync',
        { command: 'echo', parameters: ['hi'] },
        baseContext
      );

      expect(spawnSync).toHaveBeenCalledWith(
        'echo',
        ['hi'],
        expect.objectContaining({
          timeout: 60000,
        })
      );
    });

    it('should report timeout exit code (124) on SIGTERM', async () => {
      (spawnSync as jest.Mock).mockReturnValue({
        status: null,
        stdout: Buffer.from(''),
        stderr: Buffer.from(''),
        signal: 'SIGTERM',
      });

      const result = await executeShellTool(
        'exec_sync',
        { command: 'sleep', parameters: ['999'] },
        baseContext
      );

      expect((result.result as any).exit_code).toBe(124);
      expect((result.result as any).stderr).toContain('timeout exceeded');
    });
  });

  describe('chdir handler', () => {
    it('should change to default workspace dir when no path given', async () => {
      const result = await executeShellTool('chdir', {}, baseContext);

      expect(result.success).toBe(true);
      expect(result.formattedText).toContain('Changed directory');
    });

    it('should reject path traversal attempts', async () => {
      await expect(
        executeShellTool('chdir', { path: '/etc/passwd' }, baseContext)
      ).rejects.toThrow('Path traversal rejected');
    });

    it('should reject relative path traversal attempts', async () => {
      await expect(
        executeShellTool('chdir', { path: '../../../../etc' }, baseContext)
      ).rejects.toThrow('Path traversal rejected');
    });
  });

  describe('sudo_sync handler', () => {
    it('should return approval request without executing', async () => {
      const result = await executeShellTool(
        'sudo_sync',
        { command: 'apt-get', parameters: ['install', 'curl'] },
        baseContext
      );

      expect(result.requiresSudoApproval).toBe(true);
      expect(result.pendingSudoCommand).toBeDefined();
      expect(result.pendingSudoCommand!.command).toBe('apt-get');
      // Should NOT have called spawnSync
      expect(spawnSync).not.toHaveBeenCalled();
    });

    it('should reject missing command', async () => {
      await expect(
        executeShellTool('sudo_sync', {}, baseContext)
      ).rejects.toThrow('Command is required');
    });
  });

  describe('executeSudoCommand', () => {
    it('should execute with sudo after approval', async () => {
      const result = await executeSudoCommand(
        'apt-get',
        ['install', 'curl'],
        60000,
        baseContext
      );

      expect(result.success).toBe(true);
      expect(spawnSync).toHaveBeenCalledWith(
        'sudo',
        ['apt-get', 'install', 'curl'],
        expect.objectContaining({
          timeout: 60000,
          shell: false,
        })
      );
    });

    it('should reject in non-shell environment', async () => {
      (isShellEnvironment as jest.Mock).mockReturnValue(false);

      await expect(
        executeSudoCommand('apt-get', ['install', 'curl'], 60000, baseContext)
      ).rejects.toThrow('Shell tools are only available');
    });
  });

  describe('async_result handler', () => {
    it('should reject invalid PID', async () => {
      await expect(
        executeShellTool('async_result', { pid: null }, baseContext)
      ).rejects.toThrow('PID is required');
    });

    it('should return not_found for unknown PID', async () => {
      const result = await executeShellTool(
        'async_result',
        { pid: 99999 },
        baseContext
      );

      expect(result.success).toBe(true);
      expect((result.result as any).status).toBe('not_found');
    });
  });

  describe('cp_host handler', () => {
    it('should reject missing source or destination', async () => {
      await expect(
        executeShellTool('cp_host', { source: '', destination: 'workspace:/test' }, baseContext)
      ).rejects.toThrow('Both source and destination are required');
    });

    it('should reject invalid format (neither workspace: nor files:)', async () => {
      await expect(
        executeShellTool(
          'cp_host',
          { source: '/tmp/file', destination: '/home/file' },
          baseContext
        )
      ).rejects.toThrow('Invalid source/destination format');
    });
  });

  describe('unknown tool dispatch', () => {
    it('should reject unknown tool names', async () => {
      await expect(
        executeShellTool('nonexistent_tool' as any, {}, baseContext)
      ).rejects.toThrow('Unknown shell tool');
    });
  });

  describe('ShellError', () => {
    it('should have correct name and code', () => {
      const err = new ShellError('test message', 'PATH_TRAVERSAL');
      expect(err.name).toBe('ShellError');
      expect(err.code).toBe('PATH_TRAVERSAL');
      expect(err.message).toBe('test message');
    });
  });
});
