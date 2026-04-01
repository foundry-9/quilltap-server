/**
 * Unit tests for useFormState hook
 * Tests form state management, input handling, and field updates
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { renderHook, act } from '@testing-library/react'
import { useFormState } from '@/hooks/useFormState'

describe('useFormState', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  /**
   * Initial state tests
   */
  describe('initial state', () => {
    it('should initialize with the provided state', () => {
      const initialState = { name: '', email: '', age: 0 }

      const { result } = renderHook(() => useFormState(initialState))

      expect(result.current.formData).toEqual(initialState)
    })

    it('should handle complex initial state with multiple types', () => {
      const initialState = {
        name: 'John',
        email: 'john@example.com',
        age: 30,
        acceptTerms: false,
        category: 'general',
      }

      const { result } = renderHook(() => useFormState(initialState))

      expect(result.current.formData).toEqual(initialState)
      expect(result.current.formData.name).toBe('John')
      expect(result.current.formData.age).toBe(30)
      expect(result.current.formData.acceptTerms).toBe(false)
    })

    it('should handle empty initial state', () => {
      const initialState = {}

      const { result } = renderHook(() => useFormState(initialState))

      expect(result.current.formData).toEqual({})
    })
  })

  /**
   * handleChange tests
   */
  describe('handleChange', () => {
    it('should update text input values', () => {
      const initialState = { name: '', email: '' }

      const { result } = renderHook(() => useFormState(initialState))

      const event = {
        target: {
          name: 'name',
          type: 'text',
          value: 'John Doe',
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.handleChange(event)
      })

      expect(result.current.formData.name).toBe('John Doe')
    })

    it('should handle multiple text input changes', () => {
      const initialState = { name: '', email: '' }

      const { result } = renderHook(() => useFormState(initialState))

      const nameEvent = {
        target: {
          name: 'name',
          type: 'text',
          value: 'John',
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      const emailEvent = {
        target: {
          name: 'email',
          type: 'email',
          value: 'john@example.com',
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.handleChange(nameEvent)
        result.current.handleChange(emailEvent)
      })

      expect(result.current.formData.name).toBe('John')
      expect(result.current.formData.email).toBe('john@example.com')
    })

    it('should convert checkbox inputs to boolean', () => {
      const initialState = { acceptTerms: false }

      const { result } = renderHook(() => useFormState(initialState))

      const checkboxEvent = {
        target: {
          name: 'acceptTerms',
          type: 'checkbox',
          value: 'on',
          checked: true,
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.handleChange(checkboxEvent)
      })

      expect(result.current.formData.acceptTerms).toBe(true)
      expect(typeof result.current.formData.acceptTerms).toBe('boolean')
    })

    it('should toggle checkbox from true to false', () => {
      const initialState = { acceptTerms: true }

      const { result } = renderHook(() => useFormState(initialState))

      const checkboxEvent = {
        target: {
          name: 'acceptTerms',
          type: 'checkbox',
          value: 'on',
          checked: false,
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.handleChange(checkboxEvent)
      })

      expect(result.current.formData.acceptTerms).toBe(false)
    })

    it('should handle multiple checkboxes independently', () => {
      const initialState = { acceptTerms: false, newsletter: false }

      const { result } = renderHook(() => useFormState(initialState))

      const acceptEvent = {
        target: {
          name: 'acceptTerms',
          type: 'checkbox',
          value: 'on',
          checked: true,
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      const newsletterEvent = {
        target: {
          name: 'newsletter',
          type: 'checkbox',
          value: 'on',
          checked: true,
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.handleChange(acceptEvent)
        result.current.handleChange(newsletterEvent)
      })

      expect(result.current.formData.acceptTerms).toBe(true)
      expect(result.current.formData.newsletter).toBe(true)
    })

    it('should convert number inputs to numbers', () => {
      const initialState = { age: 0 }

      const { result } = renderHook(() => useFormState(initialState))

      const numberEvent = {
        target: {
          name: 'age',
          type: 'number',
          value: '25',
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.handleChange(numberEvent)
      })

      expect(result.current.formData.age).toBe(25)
      expect(typeof result.current.formData.age).toBe('number')
    })

    it('should convert empty number input to 0', () => {
      const initialState = { age: 25 }

      const { result } = renderHook(() => useFormState(initialState))

      const numberEvent = {
        target: {
          name: 'age',
          type: 'number',
          value: '',
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.handleChange(numberEvent)
      })

      expect(result.current.formData.age).toBe(0)
    })

    it('should handle range input as number', () => {
      const initialState = { volume: 50 }

      const { result } = renderHook(() => useFormState(initialState))

      const rangeEvent = {
        target: {
          name: 'volume',
          type: 'range',
          value: '75',
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.handleChange(rangeEvent)
      })

      expect(result.current.formData.volume).toBe(75)
      expect(typeof result.current.formData.volume).toBe('number')
    })

    it('should handle select inputs', () => {
      const initialState = { category: 'general' }

      const { result } = renderHook(() => useFormState(initialState))

      const selectEvent = {
        target: {
          name: 'category',
          type: 'select-one',
          value: 'premium',
        },
      } as unknown as React.ChangeEvent<HTMLSelectElement>

      act(() => {
        result.current.handleChange(selectEvent)
      })

      expect(result.current.formData.category).toBe('premium')
    })

    it('should handle textarea inputs', () => {
      const initialState = { description: '' }

      const { result } = renderHook(() => useFormState(initialState))

      const textareaEvent = {
        target: {
          name: 'description',
          type: 'textarea',
          value: 'This is a long description',
        },
      } as unknown as React.ChangeEvent<HTMLTextAreaElement>

      act(() => {
        result.current.handleChange(textareaEvent)
      })

      expect(result.current.formData.description).toBe('This is a long description')
    })

    it('should preserve string type for non-number fields even if type is number', () => {
      const initialState = { stringField: 'text' }

      const { result } = renderHook(() => useFormState(initialState))

      const numberEvent = {
        target: {
          name: 'stringField',
          type: 'number',
          value: '123',
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.handleChange(numberEvent)
      })

      // Since initial state has a string, it should remain a string
      expect(result.current.formData.stringField).toBe('123')
      expect(typeof result.current.formData.stringField).toBe('string')
    })
  })

  /**
   * resetForm tests
   */
  describe('resetForm', () => {
    it('should reset form to initial state', () => {
      const initialState = { name: 'John', email: 'john@example.com' }

      const { result } = renderHook(() => useFormState(initialState))

      const event = {
        target: {
          name: 'name',
          type: 'text',
          value: 'Jane',
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.handleChange(event)
      })

      expect(result.current.formData.name).toBe('Jane')

      act(() => {
        result.current.resetForm()
      })

      expect(result.current.formData).toEqual(initialState)
      expect(result.current.formData.name).toBe('John')
    })

    it('should reset complex form state with mixed types', () => {
      const initialState = {
        name: 'John',
        age: 30,
        acceptTerms: true,
        category: 'premium',
      }

      const { result } = renderHook(() => useFormState(initialState))

      // Change multiple fields
      act(() => {
        result.current.setField('name', 'Jane')
        result.current.setField('age', 25)
        result.current.setField('acceptTerms', false)
      })

      expect(result.current.formData.name).toBe('Jane')
      expect(result.current.formData.age).toBe(25)
      expect(result.current.formData.acceptTerms).toBe(false)

      // Reset
      act(() => {
        result.current.resetForm()
      })

      expect(result.current.formData).toEqual(initialState)
    })

    it('should reset empty form state', () => {
      const initialState = {}

      const { result } = renderHook(() => useFormState(initialState))

      act(() => {
        result.current.resetForm()
      })

      expect(result.current.formData).toEqual({})
    })

    it('should allow editing after reset', () => {
      const initialState = { name: '', email: '' }

      const { result } = renderHook(() => useFormState(initialState))

      const event = {
        target: {
          name: 'name',
          type: 'text',
          value: 'John',
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.handleChange(event)
      })

      expect(result.current.formData.name).toBe('John')

      act(() => {
        result.current.resetForm()
      })

      expect(result.current.formData.name).toBe('')

      const secondEvent = {
        target: {
          name: 'name',
          type: 'text',
          value: 'Jane',
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.handleChange(secondEvent)
      })

      expect(result.current.formData.name).toBe('Jane')
    })
  })

  /**
   * setField tests
   */
  describe('setField', () => {
    it('should update a specific field', () => {
      const initialState = { name: 'John', email: 'john@example.com', age: 30 }

      const { result } = renderHook(() => useFormState(initialState))

      act(() => {
        result.current.setField('name', 'Jane')
      })

      expect(result.current.formData.name).toBe('Jane')
      expect(result.current.formData.email).toBe('john@example.com')
      expect(result.current.formData.age).toBe(30)
    })

    it('should update multiple fields independently', () => {
      const initialState = { name: 'John', email: 'john@example.com', age: 30 }

      const { result } = renderHook(() => useFormState(initialState))

      act(() => {
        result.current.setField('name', 'Jane')
        result.current.setField('age', 25)
      })

      expect(result.current.formData.name).toBe('Jane')
      expect(result.current.formData.age).toBe(25)
      expect(result.current.formData.email).toBe('john@example.com')
    })

    it('should handle different value types with setField', () => {
      const initialState = { name: '', age: 0, acceptTerms: false, category: '' }

      const { result } = renderHook(() => useFormState(initialState))

      act(() => {
        result.current.setField('name', 'John')
        result.current.setField('age', 30)
        result.current.setField('acceptTerms', true)
        result.current.setField('category', 'premium')
      })

      expect(result.current.formData.name).toBe('John')
      expect(result.current.formData.age).toBe(30)
      expect(result.current.formData.acceptTerms).toBe(true)
      expect(result.current.formData.category).toBe('premium')
    })

    it('should update field with empty string', () => {
      const initialState = { name: 'John', email: 'john@example.com' }

      const { result } = renderHook(() => useFormState(initialState))

      act(() => {
        result.current.setField('name', '')
      })

      expect(result.current.formData.name).toBe('')
      expect(result.current.formData.email).toBe('john@example.com')
    })

    it('should update field with null or undefined if supported', () => {
      const initialState = { name: 'John', nickname: null as string | null }

      const { result } = renderHook(() => useFormState(initialState))

      act(() => {
        result.current.setField('nickname', null as any)
      })

      expect(result.current.formData.nickname).toBeNull()
    })

    it('should allow overwriting with same value', () => {
      const initialState = { name: 'John', email: 'john@example.com' }

      const { result } = renderHook(() => useFormState(initialState))

      act(() => {
        result.current.setField('name', 'John')
      })

      expect(result.current.formData.name).toBe('John')
    })

    it('should work with complex value types', () => {
      const initialState = { name: 'John', tags: [] as string[], metadata: {} as Record<string, any> }

      const { result } = renderHook(() => useFormState(initialState))

      const newTags = ['tag1', 'tag2']
      const newMetadata = { key: 'value' }

      act(() => {
        result.current.setField('tags', newTags)
        result.current.setField('metadata', newMetadata)
      })

      expect(result.current.formData.tags).toEqual(newTags)
      expect(result.current.formData.metadata).toEqual(newMetadata)
    })
  })

  /**
   * Integration tests
   */
  describe('integration', () => {
    it('should handle a complete form workflow', () => {
      const initialState = {
        name: '',
        email: '',
        age: 0,
        acceptTerms: false,
      }

      const { result } = renderHook(() => useFormState(initialState))

      // Fill in the form
      const nameEvent = {
        target: {
          name: 'name',
          type: 'text',
          value: 'John Doe',
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      const emailEvent = {
        target: {
          name: 'email',
          type: 'email',
          value: 'john@example.com',
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      const ageEvent = {
        target: {
          name: 'age',
          type: 'number',
          value: '30',
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      const termsEvent = {
        target: {
          name: 'acceptTerms',
          type: 'checkbox',
          value: 'on',
          checked: true,
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.handleChange(nameEvent)
        result.current.handleChange(emailEvent)
        result.current.handleChange(ageEvent)
        result.current.handleChange(termsEvent)
      })

      expect(result.current.formData).toEqual({
        name: 'John Doe',
        email: 'john@example.com',
        age: 30,
        acceptTerms: true,
      })

      // Update a single field
      act(() => {
        result.current.setField('email', 'newemail@example.com')
      })

      expect(result.current.formData.email).toBe('newemail@example.com')
      expect(result.current.formData.name).toBe('John Doe')

      // Reset
      act(() => {
        result.current.resetForm()
      })

      expect(result.current.formData).toEqual(initialState)
    })

    it('should maintain state consistency across multiple operations', () => {
      const initialState = { field1: 'a', field2: 'b', field3: 'c' }

      const { result } = renderHook(() => useFormState(initialState))

      act(() => {
        result.current.setField('field1', 'x')
      })

      const event = {
        target: {
          name: 'field2',
          type: 'text',
          value: 'y',
        },
      } as unknown as React.ChangeEvent<HTMLInputElement>

      act(() => {
        result.current.handleChange(event)
      })

      expect(result.current.formData.field1).toBe('x')
      expect(result.current.formData.field2).toBe('y')
      expect(result.current.formData.field3).toBe('c')

      act(() => {
        result.current.resetForm()
      })

      expect(result.current.formData).toEqual(initialState)
    })
  })
})
