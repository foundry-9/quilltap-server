/**
 * Unit tests for lib/utils/format-tokens.ts
 * Tests token and cost formatting utilities
 */

import { formatCostForDisplay, formatTokenCount } from '@/lib/utils/format-tokens';

describe('formatCostForDisplay', () => {
  describe('null and zero values', () => {
    it('should return "N/A" for null', () => {
      expect(formatCostForDisplay(null)).toBe('N/A');
    });

    it('should return "Free" for zero cost', () => {
      expect(formatCostForDisplay(0)).toBe('Free');
    });
  });

  describe('very small costs', () => {
    it('should format costs less than $0.01 with 4 decimals', () => {
      expect(formatCostForDisplay(0.0023)).toBe('$0.0023');
    });

    it('should format very small costs', () => {
      expect(formatCostForDisplay(0.0001)).toBe('$0.0001');
    });

    it('should handle edge case at $0.01', () => {
      expect(formatCostForDisplay(0.009999)).toBe('$0.0100');
    });

    it('should format $0.0099', () => {
      expect(formatCostForDisplay(0.0099)).toBe('$0.0099');
    });
  });

  describe('costs between $0.01 and $1', () => {
    it('should format $0.01 with 3 decimals', () => {
      expect(formatCostForDisplay(0.01)).toBe('$0.010');
    });

    it('should format $0.05 with 3 decimals', () => {
      expect(formatCostForDisplay(0.05)).toBe('$0.050');
    });

    it('should format $0.123 with 3 decimals', () => {
      expect(formatCostForDisplay(0.123)).toBe('$0.123');
    });

    it('should format $0.999 with 3 decimals', () => {
      expect(formatCostForDisplay(0.999)).toBe('$0.999');
    });

    it('should handle rounding at 3 decimals', () => {
      expect(formatCostForDisplay(0.1234)).toBe('$0.123');
    });
  });

  describe('costs $1 and above', () => {
    it('should format $1 with 2 decimals', () => {
      expect(formatCostForDisplay(1)).toBe('$1.00');
    });

    it('should format $1.50 with 2 decimals', () => {
      expect(formatCostForDisplay(1.5)).toBe('$1.50');
    });

    it('should format $10.99 with 2 decimals', () => {
      expect(formatCostForDisplay(10.99)).toBe('$10.99');
    });

    it('should format $100 with 2 decimals', () => {
      expect(formatCostForDisplay(100)).toBe('$100.00');
    });

    it('should format large costs', () => {
      expect(formatCostForDisplay(1234.56)).toBe('$1234.56');
    });

    it('should handle rounding at 2 decimals', () => {
      expect(formatCostForDisplay(1.999)).toBe('$2.00');
    });
  });

  describe('edge cases', () => {
    it('should handle very tiny costs', () => {
      expect(formatCostForDisplay(0.00001)).toBe('$0.0000');
    });

    it('should handle negative costs', () => {
      // While unusual, should handle gracefully
      // Negative values < $1 get 4 decimal places since they're < 0.01
      expect(formatCostForDisplay(-0.5)).toBe('$-0.5000');
    });

    it('should handle very large costs', () => {
      expect(formatCostForDisplay(999999.99)).toBe('$999999.99');
    });
  });
});

describe('formatTokenCount', () => {
  describe('small token counts', () => {
    it('should format 0 tokens', () => {
      expect(formatTokenCount(0)).toBe('0');
    });

    it('should format 1 token', () => {
      expect(formatTokenCount(1)).toBe('1');
    });

    it('should format 999 tokens', () => {
      expect(formatTokenCount(999)).toBe('999');
    });

    it('should format 500 tokens', () => {
      expect(formatTokenCount(500)).toBe('500');
    });
  });

  describe('thousands (K)', () => {
    it('should format 1,000 tokens as 1.0K', () => {
      expect(formatTokenCount(1000)).toBe('1.0K');
    });

    it('should format 1,500 tokens as 1.5K', () => {
      expect(formatTokenCount(1500)).toBe('1.5K');
    });

    it('should format 10,000 tokens as 10.0K', () => {
      expect(formatTokenCount(10000)).toBe('10.0K');
    });

    it('should format 999,999 tokens as 1000.0K', () => {
      expect(formatTokenCount(999999)).toBe('1000.0K');
    });

    it('should handle rounding', () => {
      expect(formatTokenCount(1234)).toBe('1.2K');
    });

    it('should format 50,000 tokens', () => {
      expect(formatTokenCount(50000)).toBe('50.0K');
    });
  });

  describe('millions (M)', () => {
    it('should format 1,000,000 tokens as 1.0M', () => {
      expect(formatTokenCount(1000000)).toBe('1.0M');
    });

    it('should format 1,500,000 tokens as 1.5M', () => {
      expect(formatTokenCount(1500000)).toBe('1.5M');
    });

    it('should format 2,300,000 tokens as 2.3M', () => {
      expect(formatTokenCount(2300000)).toBe('2.3M');
    });

    it('should format 10,000,000 tokens as 10.0M', () => {
      expect(formatTokenCount(10000000)).toBe('10.0M');
    });

    it('should handle rounding', () => {
      expect(formatTokenCount(1234567)).toBe('1.2M');
    });

    it('should format very large counts', () => {
      expect(formatTokenCount(999999999)).toBe('1000.0M');
    });
  });

  describe('boundary cases', () => {
    it('should format 999 as number', () => {
      expect(formatTokenCount(999)).toBe('999');
    });

    it('should format 1000 as K', () => {
      expect(formatTokenCount(1000)).toBe('1.0K');
    });

    it('should format 999999 as K', () => {
      expect(formatTokenCount(999999)).toBe('1000.0K');
    });

    it('should format 1000000 as M', () => {
      expect(formatTokenCount(1000000)).toBe('1.0M');
    });
  });

  describe('edge cases', () => {
    it('should handle negative numbers', () => {
      // While unusual, should handle gracefully
      // Negative numbers are formatted as-is without K/M suffix
      expect(formatTokenCount(-1000)).toBe('-1000');
    });

    it('should handle decimal input (rounds down)', () => {
      expect(formatTokenCount(1500.9)).toBe('1.5K');
    });
  });
});
