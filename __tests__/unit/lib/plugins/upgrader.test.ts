/**
 * Unit tests for plugin upgrader
 */

import { upgradePlugins } from '@/lib/plugins/upgrader';
import type { PluginUpdateInfo } from '@/lib/plugins/version-checker';

// Mock the installer module
jest.mock('@/lib/plugins/installer', () => ({
  installPluginFromNpm: jest.fn(),
}));

// Mock the logger
jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { installPluginFromNpm } from '@/lib/plugins/installer';

const mockInstallPluginFromNpm = installPluginFromNpm as jest.MockedFunction<typeof installPluginFromNpm>;

describe('Plugin Upgrader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('upgradePlugins', () => {
    it('should return empty results for empty input', async () => {
      const results = await upgradePlugins([]);

      expect(results.upgraded).toHaveLength(0);
      expect(results.failed).toHaveLength(0);
      expect(results.totalChecked).toBe(0);
    });

    it('should upgrade a single plugin successfully', async () => {
      const updates: PluginUpdateInfo[] = [
        {
          packageName: 'qtap-plugin-test',
          currentVersion: '1.0.0',
          latestVersion: '1.1.0',
          isNonBreaking: true,
        },
      ];

      mockInstallPluginFromNpm.mockResolvedValueOnce({
        success: true,
        version: '1.1.0',
        requiresRestart: false,
      });

      const results = await upgradePlugins(updates);

      expect(results.upgraded).toHaveLength(1);
      expect(results.failed).toHaveLength(0);
      expect(results.totalChecked).toBe(1);
      expect(results.upgraded[0]).toEqual({
        packageName: 'qtap-plugin-test',
        success: true,
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
        requiresRestart: false,
      });
      expect(mockInstallPluginFromNpm).toHaveBeenCalledWith('qtap-plugin-test');
    });

    it('should handle upgrade failure', async () => {
      const updates: PluginUpdateInfo[] = [
        {
          packageName: 'qtap-plugin-failing',
          currentVersion: '1.0.0',
          latestVersion: '1.1.0',
          isNonBreaking: true,
        },
      ];

      mockInstallPluginFromNpm.mockResolvedValueOnce({
        success: false,
        error: 'Network error',
      });

      const results = await upgradePlugins(updates);

      expect(results.upgraded).toHaveLength(0);
      expect(results.failed).toHaveLength(1);
      expect(results.totalChecked).toBe(1);
      expect(results.failed[0]).toEqual({
        packageName: 'qtap-plugin-failing',
        success: false,
        fromVersion: '1.0.0',
        error: 'Network error',
        requiresRestart: false,
      });
    });

    it('should upgrade multiple plugins sequentially', async () => {
      const updates: PluginUpdateInfo[] = [
        {
          packageName: 'qtap-plugin-first',
          currentVersion: '1.0.0',
          latestVersion: '1.1.0',
          isNonBreaking: true,
        },
        {
          packageName: 'qtap-plugin-second',
          currentVersion: '2.0.0',
          latestVersion: '2.0.5',
          isNonBreaking: true,
        },
      ];

      mockInstallPluginFromNpm
        .mockResolvedValueOnce({
          success: true,
          version: '1.1.0',
          requiresRestart: false,
        })
        .mockResolvedValueOnce({
          success: true,
          version: '2.0.5',
          requiresRestart: true,
        });

      const results = await upgradePlugins(updates);

      expect(results.upgraded).toHaveLength(2);
      expect(results.failed).toHaveLength(0);
      expect(results.totalChecked).toBe(2);

      // Verify sequential calls
      expect(mockInstallPluginFromNpm).toHaveBeenCalledTimes(2);
      expect(mockInstallPluginFromNpm).toHaveBeenNthCalledWith(1, 'qtap-plugin-first');
      expect(mockInstallPluginFromNpm).toHaveBeenNthCalledWith(2, 'qtap-plugin-second');
    });

    it('should handle mixed success and failure', async () => {
      const updates: PluginUpdateInfo[] = [
        {
          packageName: 'qtap-plugin-success',
          currentVersion: '1.0.0',
          latestVersion: '1.1.0',
          isNonBreaking: true,
        },
        {
          packageName: 'qtap-plugin-fail',
          currentVersion: '2.0.0',
          latestVersion: '2.1.0',
          isNonBreaking: true,
        },
        {
          packageName: 'qtap-plugin-success-2',
          currentVersion: '3.0.0',
          latestVersion: '3.0.1',
          isNonBreaking: true,
        },
      ];

      mockInstallPluginFromNpm
        .mockResolvedValueOnce({
          success: true,
          version: '1.1.0',
          requiresRestart: false,
        })
        .mockResolvedValueOnce({
          success: false,
          error: 'Manifest validation failed',
        })
        .mockResolvedValueOnce({
          success: true,
          version: '3.0.1',
          requiresRestart: false,
        });

      const results = await upgradePlugins(updates);

      expect(results.upgraded).toHaveLength(2);
      expect(results.failed).toHaveLength(1);
      expect(results.totalChecked).toBe(3);

      expect(results.upgraded.map(r => r.packageName)).toEqual([
        'qtap-plugin-success',
        'qtap-plugin-success-2',
      ]);
      expect(results.failed[0].packageName).toBe('qtap-plugin-fail');
    });

    it('should handle exception during upgrade', async () => {
      const updates: PluginUpdateInfo[] = [
        {
          packageName: 'qtap-plugin-throws',
          currentVersion: '1.0.0',
          latestVersion: '1.1.0',
          isNonBreaking: true,
        },
      ];

      mockInstallPluginFromNpm.mockRejectedValueOnce(new Error('Unexpected error'));

      const results = await upgradePlugins(updates);

      expect(results.upgraded).toHaveLength(0);
      expect(results.failed).toHaveLength(1);
      expect(results.failed[0].error).toBe('Unexpected error');
    });

    it('should track requiresRestart flag', async () => {
      const updates: PluginUpdateInfo[] = [
        {
          packageName: 'qtap-plugin-restart',
          currentVersion: '1.0.0',
          latestVersion: '1.1.0',
          isNonBreaking: true,
        },
      ];

      mockInstallPluginFromNpm.mockResolvedValueOnce({
        success: true,
        version: '1.1.0',
        requiresRestart: true,
      });

      const results = await upgradePlugins(updates);

      expect(results.upgraded[0].requiresRestart).toBe(true);
    });

    it('should use latestVersion when result.version is undefined', async () => {
      const updates: PluginUpdateInfo[] = [
        {
          packageName: 'qtap-plugin-no-version',
          currentVersion: '1.0.0',
          latestVersion: '1.1.0',
          isNonBreaking: true,
        },
      ];

      mockInstallPluginFromNpm.mockResolvedValueOnce({
        success: true,
        // version is undefined
        requiresRestart: false,
      });

      const results = await upgradePlugins(updates);

      expect(results.upgraded[0].toVersion).toBe('1.1.0');
    });
  });
});
