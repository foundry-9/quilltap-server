/**
 * Unit Tests for Model Classes
 * Tests lib/llm/model-classes.ts
 */

import { describe, it, expect } from '@jest/globals'
import {
  MODEL_CLASSES,
  MODEL_CLASS_NAMES,
  getModelClass,
  isValidModelClassName,
} from '@/lib/llm/model-classes'

describe('Model Classes', () => {
  describe('MODEL_CLASSES', () => {
    it('should contain exactly 4 model classes', () => {
      expect(MODEL_CLASSES).toHaveLength(4)
    })

    it('should have Compact as the first class with correct properties', () => {
      const compact = MODEL_CLASSES[0]
      expect(compact.name).toBe('Compact')
      expect(compact.tier).toBe('A')
      expect(compact.maxContext).toBe(32000)
      expect(compact.maxOutput).toBe(4000)
      expect(compact.quality).toBe(0)
      expect(compact.tags).toEqual(['SMALL', 'CHEAP', 'LOCAL'])
    })

    it('should have Standard as the second class with correct properties', () => {
      const standard = MODEL_CLASSES[1]
      expect(standard.name).toBe('Standard')
      expect(standard.tier).toBe('B')
      expect(standard.maxContext).toBe(128000)
      expect(standard.maxOutput).toBe(16000)
      expect(standard.quality).toBe(1)
      expect(standard.tags).toEqual(['BUDGET'])
    })

    it('should have Extended as the third class with correct properties', () => {
      const extended = MODEL_CLASSES[2]
      expect(extended.name).toBe('Extended')
      expect(extended.tier).toBe('C')
      expect(extended.maxContext).toBe(200000)
      expect(extended.maxOutput).toBe(128000)
      expect(extended.quality).toBe(2)
      expect(extended.tags).toEqual(['CREATIVE', 'THINKING'])
    })

    it('should have Deep as the fourth class with correct properties', () => {
      const deep = MODEL_CLASSES[3]
      expect(deep.name).toBe('Deep')
      expect(deep.tier).toBe('D')
      expect(deep.maxContext).toBe(1000000)
      expect(deep.maxOutput).toBe(128000)
      expect(deep.quality).toBe(3)
      expect(deep.tags).toEqual(['MAX'])
    })

    it('should have quality values in ascending order', () => {
      for (let i = 1; i < MODEL_CLASSES.length; i++) {
        expect(MODEL_CLASSES[i].quality).toBeGreaterThan(MODEL_CLASSES[i - 1].quality)
      }
    })

    it('should have maxContext values in ascending order', () => {
      for (let i = 1; i < MODEL_CLASSES.length; i++) {
        expect(MODEL_CLASSES[i].maxContext).toBeGreaterThan(MODEL_CLASSES[i - 1].maxContext)
      }
    })

    it('should have maxContext values that are reasonable (at least 1000 tokens)', () => {
      for (const mc of MODEL_CLASSES) {
        expect(mc.maxContext).toBeGreaterThanOrEqual(1000)
      }
    })

    it('should have maxOutput values less than or equal to maxContext', () => {
      for (const mc of MODEL_CLASSES) {
        expect(mc.maxOutput).toBeLessThanOrEqual(mc.maxContext)
      }
    })

    it('should have unique tier letters', () => {
      const tiers = MODEL_CLASSES.map(mc => mc.tier)
      expect(new Set(tiers).size).toBe(tiers.length)
    })

    it('should have unique names', () => {
      const names = MODEL_CLASSES.map(mc => mc.name)
      expect(new Set(names).size).toBe(names.length)
    })
  })

  describe('MODEL_CLASS_NAMES', () => {
    it('should contain exactly the names from MODEL_CLASSES', () => {
      const expectedNames = MODEL_CLASSES.map(mc => mc.name)
      expect(MODEL_CLASS_NAMES).toEqual(expectedNames)
    })

    it('should contain all four class names', () => {
      expect(MODEL_CLASS_NAMES).toContain('Compact')
      expect(MODEL_CLASS_NAMES).toContain('Standard')
      expect(MODEL_CLASS_NAMES).toContain('Extended')
      expect(MODEL_CLASS_NAMES).toContain('Deep')
    })

    it('should have the same length as MODEL_CLASSES', () => {
      expect(MODEL_CLASS_NAMES).toHaveLength(MODEL_CLASSES.length)
    })
  })

  describe('getModelClass', () => {
    it('should return the Compact class for "Compact"', () => {
      const result = getModelClass('Compact')
      expect(result).toBeDefined()
      expect(result!.name).toBe('Compact')
      expect(result!.tier).toBe('A')
    })

    it('should return the Standard class for "Standard"', () => {
      const result = getModelClass('Standard')
      expect(result).toBeDefined()
      expect(result!.name).toBe('Standard')
      expect(result!.tier).toBe('B')
    })

    it('should return the Extended class for "Extended"', () => {
      const result = getModelClass('Extended')
      expect(result).toBeDefined()
      expect(result!.name).toBe('Extended')
      expect(result!.tier).toBe('C')
    })

    it('should return the Deep class for "Deep"', () => {
      const result = getModelClass('Deep')
      expect(result).toBeDefined()
      expect(result!.name).toBe('Deep')
      expect(result!.tier).toBe('D')
    })

    it('should return undefined for an invalid name', () => {
      expect(getModelClass('Nonexistent')).toBeUndefined()
    })

    it('should return undefined for an empty string', () => {
      expect(getModelClass('')).toBeUndefined()
    })

    it('should be case-sensitive (lowercase does not match)', () => {
      expect(getModelClass('compact')).toBeUndefined()
      expect(getModelClass('standard')).toBeUndefined()
      expect(getModelClass('extended')).toBeUndefined()
      expect(getModelClass('deep')).toBeUndefined()
    })

    it('should be case-sensitive (uppercase does not match)', () => {
      expect(getModelClass('COMPACT')).toBeUndefined()
      expect(getModelClass('STANDARD')).toBeUndefined()
      expect(getModelClass('EXTENDED')).toBeUndefined()
      expect(getModelClass('DEEP')).toBeUndefined()
    })

    it('should return undefined for tier letters instead of names', () => {
      expect(getModelClass('A')).toBeUndefined()
      expect(getModelClass('B')).toBeUndefined()
      expect(getModelClass('C')).toBeUndefined()
      expect(getModelClass('D')).toBeUndefined()
    })
  })

  describe('isValidModelClassName', () => {
    it('should return true for all valid model class names', () => {
      expect(isValidModelClassName('Compact')).toBe(true)
      expect(isValidModelClassName('Standard')).toBe(true)
      expect(isValidModelClassName('Extended')).toBe(true)
      expect(isValidModelClassName('Deep')).toBe(true)
    })

    it('should return false for invalid names', () => {
      expect(isValidModelClassName('Nonexistent')).toBe(false)
      expect(isValidModelClassName('Premium')).toBe(false)
      expect(isValidModelClassName('Basic')).toBe(false)
    })

    it('should return false for an empty string', () => {
      expect(isValidModelClassName('')).toBe(false)
    })

    it('should return false for case-mismatched names', () => {
      expect(isValidModelClassName('compact')).toBe(false)
      expect(isValidModelClassName('COMPACT')).toBe(false)
      expect(isValidModelClassName('STANDARD')).toBe(false)
      expect(isValidModelClassName('deep')).toBe(false)
    })

    it('should return false for names with extra whitespace', () => {
      expect(isValidModelClassName(' Compact')).toBe(false)
      expect(isValidModelClassName('Compact ')).toBe(false)
      expect(isValidModelClassName(' Compact ')).toBe(false)
    })

    it('should return false for tier letters', () => {
      expect(isValidModelClassName('A')).toBe(false)
      expect(isValidModelClassName('B')).toBe(false)
      expect(isValidModelClassName('C')).toBe(false)
      expect(isValidModelClassName('D')).toBe(false)
    })
  })
})
