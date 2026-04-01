/**
 * Plugin Upgrader Tests
 * Tests for plugin upgrading and version checking
 */

import { upgradePlugin, upgradePlugins, type UpgradeResult, type UpgradeResults } from '@/lib/plugins/upgrader';
import { isNonBreakingUpdate } from '@/lib/plugins/version-checker';
import type { PluginUpdateInfo } from '@/lib/plugins/version-checker';

// Mock the installer module
jest.mock('@/lib/plugins/installer', () => ({
  installPluginFromNpm: jest.fn(),
  getInstalledPlugins: jest.fn(),
}));

import { installPluginFromNpm } from '@/lib/plugins/installer';

const mockInstallPluginFromNpm = installPluginFromNpm as jest.MockedFunction<typeof installPluginFromNpm>;

describe('Plugin Upgrader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('upgradePlugin', () => {
    it('should successfully upgrade a plugin', async () => {
      const updateInfo: PluginUpdateInfo = {
        packageName: '@quilltap/test-plugin',
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        isNonBreaking: true,
      };

      mockInstallPluginFromNpm.mockResolvedValueOnce({
        success: true,
        version: '1.1.0',
        requiresRestart: false,
        error: undefined,
      });

      const result = await upgradePlugin(updateInfo);

      expect(result.success).toBe(true);
      expect(result.fromVersion).toBe('1.0.0');
      expect(result.toVersion).toBe('1.1.0');
      expect(result.packageName).toBe('@quilltap/test-plugin');
      expect(result.requiresRestart).toBe(false);
      expect(mockInstallPluginFromNpm).toHaveBeenCalledWith('@quilltap/test-plugin');
    });

    it('should handle failed plugin upgrade', async () => {
      const updateInfo: PluginUpdateInfo = {
        packageName: '@quilltap/test-plugin',
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        isNonBreaking: true,
      };

      mockInstallPluginFromNpm.mockResolvedValueOnce({
        success: false,
        error: 'npm package not found',
        requiresRestart: false,
      });

      const result = await upgradePlugin(updateInfo);

      expect(result.success).toBe(false);
      expect(result.error).toBe('npm package not found');
      expect(result.fromVersion).toBe('1.0.0');
      expect(result.toVersion).toBeUndefined();
    });

    it('should handle unexpected errors during upgrade', async () => {
      const updateInfo: PluginUpdateInfo = {
        packageName: '@quilltap/test-plugin',
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        isNonBreaking: true,
      };

      mockInstallPluginFromNpm.mockRejectedValueOnce(new Error('Network error'));

      const result = await upgradePlugin(updateInfo);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
      expect(result.fromVersion).toBe('1.0.0');
    });

    it('should track requiresRestart flag', async () => {
      const updateInfo: PluginUpdateInfo = {
        packageName: '@quilltap/test-plugin',
        currentVersion: '1.0.0',
        latestVersion: '2.0.0',
        isNonBreaking: false,
      };

      mockInstallPluginFromNpm.mockResolvedValueOnce({
        success: true,
        version: '2.0.0',
        requiresRestart: true,
      });

      const result = await upgradePlugin(updateInfo);

      expect(result.success).toBe(true);
      expect(result.requiresRestart).toBe(true);
    });

    it('should handle upgrade with version extraction from installer response', async () => {
      const updateInfo: PluginUpdateInfo = {
        packageName: '@quilltap/test-plugin',
        currentVersion: '1.0.0',
        latestVersion: '1.2.0',
        isNonBreaking: true,
      };

      mockInstallPluginFromNpm.mockResolvedValueOnce({
        success: true,
        version: '1.2.0',
      });

      const result = await upgradePlugin(updateInfo);

      expect(result.toVersion).toBe('1.2.0');
    });

    it('should fall back to latestVersion if installer does not return version', async () => {
      const updateInfo: PluginUpdateInfo = {
        packageName: '@quilltap/test-plugin',
        currentVersion: '1.0.0',
        latestVersion: '1.2.0',
        isNonBreaking: true,
      };

      mockInstallPluginFromNpm.mockResolvedValueOnce({
        success: true,
      });

      const result = await upgradePlugin(updateInfo);

      expect(result.toVersion).toBe('1.2.0');
    });
  });

  describe('upgradePlugins', () => {
    it('should upgrade multiple plugins sequentially', async () => {
      const updates: PluginUpdateInfo[] = [
        {
          packageName: '@quilltap/plugin-1',
          currentVersion: '1.0.0',
          latestVersion: '1.1.0',
          isNonBreaking: true,
        },
        {
          packageName: '@quilltap/plugin-2',
          currentVersion: '2.0.0',
          latestVersion: '2.1.0',
          isNonBreaking: true,
        },
      ];

      mockInstallPluginFromNpm
        .mockResolvedValueOnce({ success: true, version: '1.1.0' })
        .mockResolvedValueOnce({ success: true, version: '2.1.0' });

      const results = await upgradePlugins(updates);

      expect(results.totalChecked).toBe(2);
      expect(results.upgraded.length).toBe(2);
      expect(results.failed.length).toBe(0);
      expect(mockInstallPluginFromNpm).toHaveBeenCalledTimes(2);
    });

    it('should handle mixed successes and failures', async () => {
      const updates: PluginUpdateInfo[] = [
        {
          packageName: '@quilltap/plugin-1',
          currentVersion: '1.0.0',
          latestVersion: '1.1.0',
          isNonBreaking: true,
        },
        {
          packageName: '@quilltap/plugin-2',
          currentVersion: '2.0.0',
          latestVersion: '2.1.0',
          isNonBreaking: true,
        },
        {
          packageName: '@quilltap/plugin-3',
          currentVersion: '3.0.0',
          latestVersion: '3.1.0',
          isNonBreaking: true,
        },
      ];

      mockInstallPluginFromNpm
        .mockResolvedValueOnce({ success: true, version: '1.1.0' })
        .mockResolvedValueOnce({ success: false, error: 'Not found' })
        .mockResolvedValueOnce({ success: true, version: '3.1.0' });

      const results = await upgradePlugins(updates);

      expect(results.totalChecked).toBe(3);
      expect(results.upgraded.length).toBe(2);
      expect(results.failed.length).toBe(1);
      expect(results.failed[0].packageName).toBe('@quilltap/plugin-2');
    });

    it('should return empty results for empty update list', async () => {
      const results = await upgradePlugins([]);

      expect(results.totalChecked).toBe(0);
      expect(results.upgraded.length).toBe(0);
      expect(results.failed.length).toBe(0);
      expect(mockInstallPluginFromNpm).not.toHaveBeenCalled();
    });

    it('should handle all upgrades failing', async () => {
      const updates: PluginUpdateInfo[] = [
        {
          packageName: '@quilltap/plugin-1',
          currentVersion: '1.0.0',
          latestVersion: '1.1.0',
          isNonBreaking: true,
        },
        {
          packageName: '@quilltap/plugin-2',
          currentVersion: '2.0.0',
          latestVersion: '2.1.0',
          isNonBreaking: true,
        },
      ];

      mockInstallPluginFromNpm
        .mockResolvedValueOnce({ success: false, error: 'Error 1' })
        .mockResolvedValueOnce({ success: false, error: 'Error 2' });

      const results = await upgradePlugins(updates);

      expect(results.totalChecked).toBe(2);
      expect(results.upgraded.length).toBe(0);
      expect(results.failed.length).toBe(2);
    });

    it('should handle all upgrades succeeding', async () => {
      const updates: PluginUpdateInfo[] = [
        {
          packageName: '@quilltap/plugin-1',
          currentVersion: '1.0.0',
          latestVersion: '1.1.0',
          isNonBreaking: true,
        },
        {
          packageName: '@quilltap/plugin-2',
          currentVersion: '2.0.0',
          latestVersion: '2.1.0',
          isNonBreaking: true,
        },
      ];

      mockInstallPluginFromNpm
        .mockResolvedValueOnce({ success: true, version: '1.1.0' })
        .mockResolvedValueOnce({ success: true, version: '2.1.0' });

      const results = await upgradePlugins(updates);

      expect(results.totalChecked).toBe(2);
      expect(results.upgraded.length).toBe(2);
      expect(results.failed.length).toBe(0);
    });

    it('should continue upgrading even if one plugin fails', async () => {
      const updates: PluginUpdateInfo[] = [
        {
          packageName: '@quilltap/plugin-1',
          currentVersion: '1.0.0',
          latestVersion: '1.1.0',
          isNonBreaking: true,
        },
        {
          packageName: '@quilltap/plugin-2',
          currentVersion: '2.0.0',
          latestVersion: '2.1.0',
          isNonBreaking: true,
        },
      ];

      mockInstallPluginFromNpm
        .mockResolvedValueOnce({ success: false, error: 'Network error' })
        .mockResolvedValueOnce({ success: true, version: '2.1.0' });

      const results = await upgradePlugins(updates);

      expect(results.totalChecked).toBe(2);
      expect(results.upgraded.length).toBe(1);
      expect(results.failed.length).toBe(1);
      expect(mockInstallPluginFromNpm).toHaveBeenCalledTimes(2);
    });

    it('should provide correct summary in results', async () => {
      const updates: PluginUpdateInfo[] = [
        {
          packageName: '@quilltap/plugin-1',
          currentVersion: '1.0.0',
          latestVersion: '1.1.0',
          isNonBreaking: true,
        },
      ];

      mockInstallPluginFromNpm.mockResolvedValueOnce({ success: true, version: '1.1.0' });

      const results = await upgradePlugins(updates);

      expect(results.upgraded[0].packageName).toBe('@quilltap/plugin-1');
      expect(results.upgraded[0].success).toBe(true);
      expect(results.upgraded[0].fromVersion).toBe('1.0.0');
      expect(results.upgraded[0].toVersion).toBe('1.1.0');
    });
  });

  describe('Version comparison', () => {
    it('should correctly identify non-breaking updates', () => {
      expect(isNonBreakingUpdate('1.0.0', '1.1.0')).toBe(true);
      expect(isNonBreakingUpdate('1.0.0', '1.0.1')).toBe(true);
      expect(isNonBreakingUpdate('1.5.3', '1.6.0')).toBe(true);
    });

    it('should correctly identify breaking updates', () => {
      expect(isNonBreakingUpdate('1.0.0', '2.0.0')).toBe(false);
      expect(isNonBreakingUpdate('2.5.0', '3.0.0')).toBe(false);
      expect(isNonBreakingUpdate('0.1.0', '1.0.0')).toBe(false);
    });

    it('should handle version strings with v prefix', () => {
      expect(isNonBreakingUpdate('v1.0.0', 'v1.1.0')).toBe(true);
      expect(isNonBreakingUpdate('v1.0.0', 'v2.0.0')).toBe(false);
    });

    it('should handle mixed version string formats', () => {
      expect(isNonBreakingUpdate('1.0.0', 'v1.1.0')).toBe(true);
      expect(isNonBreakingUpdate('v1.0.0', '1.1.0')).toBe(true);
    });

    it('should treat unparseable versions as breaking by default', () => {
      expect(isNonBreakingUpdate('invalid', '1.0.0')).toBe(false);
      expect(isNonBreakingUpdate('1.0.0', 'invalid')).toBe(false);
    });
  });
});
