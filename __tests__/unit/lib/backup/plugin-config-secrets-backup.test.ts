/**
 * @jest-environment node
 *
 * A backup leaves plugin config secrets behind, as it does API keys:
 * password-typed and `secret` fields are removed and named in
 * `_redactedKeys`. Drives the real `createBackup` and reads the staged
 * plugin-configs.json at the moment the shell `zip` would run.
 */

import fs from 'fs';
import path from 'path';

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn().mockReturnValue({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

jest.mock('@/lib/repositories/user-scoped', () => ({
  getUserRepositories: jest.fn(),
}));

jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: jest.fn(),
}));

jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: { downloadFile: jest.fn() },
}));

jest.mock('@/lib/paths', () => ({
  getNpmPluginsDir: jest.fn(() => '/tmp/qt-compact-test-absent-plugins'),
  getThemesDir: jest.fn(() => '/tmp/qt-compact-test-absent-themes'),
}));

jest.mock('@/lib/database/backends/sqlite/client', () => ({
  getRawDatabase: jest.fn(() => null),
}));
jest.mock('@/lib/database/backends/sqlite/protection', () => ({
  runBackupCheckpoint: jest.fn(),
}));
jest.mock('@/lib/database/backends/sqlite/llm-logs-client', () => ({
  getRawLLMLogsDatabase: jest.fn(() => null),
}));
jest.mock('@/lib/database/backends/sqlite/llm-logs-protection', () => ({
  runLLMLogsBackupCheckpoint: jest.fn(),
}));
jest.mock('@/lib/database/backends/sqlite/mount-index-client', () => ({
  getRawMountIndexDatabase: jest.fn(() => null),
  isMountIndexDegraded: jest.fn(() => true),
}));
jest.mock('@/lib/database/backends/sqlite/mount-index-protection', () => ({
  runMountIndexBackupCheckpoint: jest.fn(),
}));


jest.mock('@/lib/plugins/registry', () => ({
  getPlugin: jest.fn(),
}));

let stagedPluginConfigs: unknown[] = [];
jest.mock('child_process', () => ({
  execFile: (
    _cmd: string,
    args: string[],
    opts: { cwd: string },
    cb: (err: Error | null, out: { stdout: string; stderr: string }) => void
  ) => {
    const [, zipPath, folderName] = args;
    const p = path.join(opts.cwd, folderName, 'data', 'plugin-configs.json');
    stagedPluginConfigs = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
    fs.writeFileSync(zipPath, 'not really a zip');
    cb(null, { stdout: '', stderr: '' });
  },
}));

import { createBackup } from '@/lib/backup/backup-service';
import { getUserRepositories } from '@/lib/repositories/user-scoped';
import { getRepositories } from '@/lib/repositories/factory';
import { getPlugin } from '@/lib/plugins/registry';

function methodStub(overrides: Record<string, unknown> = {}) {
  const cache = new Map<string, unknown>();
  return new Proxy(overrides, {
    get(target, prop: string) {
      if (prop in target) return (target as Record<string, unknown>)[prop];
      if (!cache.has(prop)) cache.set(prop, jest.fn().mockResolvedValue([]));
      return cache.get(prop);
    },
  });
}

function repoStub(overrides: Record<string, unknown> = {}) {
  const cache = new Map<string, unknown>();
  return new Proxy(overrides, {
    get(target, prop: string) {
      if (prop in target) return (target as Record<string, unknown>)[prop];
      if (!cache.has(prop)) cache.set(prop, methodStub());
      return cache.get(prop);
    },
  });
}

it('removes secret plugin config keys from the backup and names them', async () => {
  const now = new Date().toISOString();
  (getUserRepositories as jest.Mock).mockReturnValue(repoStub({
    llmLogs: methodStub({ findAll: jest.fn().mockResolvedValue([]) }),
  }));
  (getRepositories as jest.Mock).mockReturnValue(repoStub({
    chatSettings: methodStub({ findByUserId: jest.fn().mockResolvedValue(null) }),
    textReplacementRules: methodStub({ list: jest.fn().mockResolvedValue([]) }),
    pluginConfigs: methodStub({
      findByUserId: jest.fn().mockResolvedValue([
        {
          id: 'pc-1', userId: 'u', pluginName: 'qtap-plugin-mcp', enabled: true,
          config: { servers: '[{"bearerToken":"tok-secret-123"}]', discoveryTimeout: 30 },
          createdAt: now, updatedAt: now,
        },
      ]),
    }),
  }));
  (getPlugin as jest.Mock).mockReturnValue({
    manifest: { configSchema: [{ key: 'servers', type: 'textarea', secret: true }, { key: 'discoveryTimeout', type: 'number' }] },
  });

  const { zipPath } = await createBackup('u');
  await fs.promises.rm(path.dirname(zipPath), { recursive: true, force: true });

  expect(JSON.stringify(stagedPluginConfigs)).not.toContain('tok-secret-123');
  expect(stagedPluginConfigs).toEqual([
    expect.objectContaining({ config: { discoveryTimeout: 30 }, _redactedKeys: ['servers'] }),
  ]);
});
