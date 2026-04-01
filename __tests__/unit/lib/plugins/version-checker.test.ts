/**
 * Unit tests for plugin version checker
 */

import { isNonBreakingUpdate } from '@/lib/plugins/version-checker';

describe('Plugin Version Checker', () => {
  describe('isNonBreakingUpdate', () => {
    describe('patch version updates', () => {
      it('should return true for patch version increase', () => {
        expect(isNonBreakingUpdate('1.0.0', '1.0.1')).toBe(true);
        expect(isNonBreakingUpdate('1.0.0', '1.0.5')).toBe(true);
        expect(isNonBreakingUpdate('2.3.4', '2.3.99')).toBe(true);
      });

      it('should return true for patch version with same major/minor', () => {
        expect(isNonBreakingUpdate('0.1.0', '0.1.1')).toBe(true);
        expect(isNonBreakingUpdate('10.20.30', '10.20.31')).toBe(true);
      });
    });

    describe('minor version updates', () => {
      it('should return true for minor version increase', () => {
        expect(isNonBreakingUpdate('1.0.0', '1.1.0')).toBe(true);
        expect(isNonBreakingUpdate('1.0.0', '1.5.0')).toBe(true);
        expect(isNonBreakingUpdate('2.3.4', '2.10.0')).toBe(true);
      });

      it('should return true for minor+patch version increase', () => {
        expect(isNonBreakingUpdate('1.0.0', '1.1.1')).toBe(true);
        expect(isNonBreakingUpdate('1.2.3', '1.5.10')).toBe(true);
      });
    });

    describe('major version updates (breaking)', () => {
      it('should return false for major version increase', () => {
        expect(isNonBreakingUpdate('1.0.0', '2.0.0')).toBe(false);
        expect(isNonBreakingUpdate('1.5.3', '2.0.0')).toBe(false);
        expect(isNonBreakingUpdate('0.9.9', '1.0.0')).toBe(false);
      });

      it('should return false for major+minor version increase', () => {
        expect(isNonBreakingUpdate('1.0.0', '2.1.0')).toBe(false);
        expect(isNonBreakingUpdate('1.2.3', '3.4.5')).toBe(false);
      });

      it('should return false when major decreases (downgrade)', () => {
        expect(isNonBreakingUpdate('2.0.0', '1.5.0')).toBe(false);
      });
    });

    describe('same version', () => {
      it('should return true for identical versions', () => {
        expect(isNonBreakingUpdate('1.0.0', '1.0.0')).toBe(true);
        expect(isNonBreakingUpdate('2.5.3', '2.5.3')).toBe(true);
      });
    });

    describe('version string variations', () => {
      it('should handle versions with v prefix', () => {
        expect(isNonBreakingUpdate('v1.0.0', 'v1.0.1')).toBe(true);
        expect(isNonBreakingUpdate('v1.0.0', 'v2.0.0')).toBe(false);
        expect(isNonBreakingUpdate('1.0.0', 'v1.0.1')).toBe(true);
        expect(isNonBreakingUpdate('v1.0.0', '1.0.1')).toBe(true);
      });

      it('should handle pre-release versions', () => {
        // Pre-release suffixes are stripped for major version comparison
        expect(isNonBreakingUpdate('1.0.0-alpha', '1.0.1')).toBe(true);
        expect(isNonBreakingUpdate('1.0.0', '1.0.1-beta')).toBe(true);
        expect(isNonBreakingUpdate('1.0.0-alpha', '2.0.0-beta')).toBe(false);
      });

      it('should handle versions with build metadata', () => {
        expect(isNonBreakingUpdate('1.0.0+build.1', '1.0.1')).toBe(true);
        expect(isNonBreakingUpdate('1.0.0', '1.0.1+build.2')).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should handle zero versions', () => {
        expect(isNonBreakingUpdate('0.0.0', '0.0.1')).toBe(true);
        expect(isNonBreakingUpdate('0.0.0', '0.1.0')).toBe(true);
        expect(isNonBreakingUpdate('0.0.0', '1.0.0')).toBe(false);
      });

      it('should return false for invalid version strings', () => {
        // Invalid versions should be treated as breaking to be safe
        expect(isNonBreakingUpdate('invalid', '1.0.0')).toBe(false);
        expect(isNonBreakingUpdate('1.0.0', 'invalid')).toBe(false);
        expect(isNonBreakingUpdate('not.a.version', 'also.not.version')).toBe(false);
      });

      it('should handle large version numbers', () => {
        expect(isNonBreakingUpdate('100.200.300', '100.200.301')).toBe(true);
        expect(isNonBreakingUpdate('100.200.300', '100.201.0')).toBe(true);
        expect(isNonBreakingUpdate('100.200.300', '101.0.0')).toBe(false);
      });
    });
  });
});
