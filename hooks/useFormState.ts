'use client';

import { useState } from 'react';
import { clientLogger } from '@/lib/client-logger';

/**
 * Hook for managing form state with automatic type handling
 *
 * Provides utilities for:
 * - Managing form data state
 * - Handling form input changes with automatic type conversion
 * - Resetting form to initial state
 * - Updating individual fields
 *
 * @template T - The shape of the form state object
 * @param initialState - The initial state of the form
 * @returns Object containing formData, setFormData, handleChange, resetForm, and setField
 *
 * @example
 * // Basic usage with text inputs
 * const form = useFormState({ name: '', email: '' })
 * return (
 *   <form>
 *     <input
 *       name="name"
 *       value={form.formData.name}
 *       onChange={form.handleChange}
 *     />
 *   </form>
 * )
 *
 * @example
 * // With different input types
 * const form = useFormState({
 *   name: '',
 *   age: 0,
 *   acceptTerms: false,
 *   category: 'general'
 * })
 * // Type conversion is automatic based on initialState types
 */
export function useFormState<T extends Record<string, any>>(initialState: T) {
  const [formData, setFormData] = useState<T>(initialState);

  /**
   * Handles input change events with automatic type conversion
   * - Text/textarea: string
   * - Checkbox: boolean
   * - Number inputs: number (if initial value was a number)
   * - Select: string or the appropriate type
   */
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, type, value } = e.target;

    clientLogger.debug('Form input changed', {
      fieldName: name,
      inputType: type,
    });

    setFormData((prevState) => {
      let newValue: any = value;

      if (type === 'checkbox') {
        // Convert to boolean for checkbox inputs
        const checkboxElement = e.target as HTMLInputElement;
        newValue = checkboxElement.checked;
        clientLogger.debug('Checkbox value converted', {
          fieldName: name,
          checked: newValue,
        });
      } else if (type === 'number' || type === 'range') {
        // Convert to number if the initial value was a number
        const initialValue = prevState[name as keyof T];
        if (typeof initialValue === 'number') {
          newValue = value === '' ? 0 : Number(value);
          clientLogger.debug('Number value converted', {
            fieldName: name,
            numValue: newValue,
          });
        }
      } else if (type === 'select-multiple') {
        // Handle multi-select
        const selectElement = e.target as HTMLSelectElement;
        newValue = Array.from(selectElement.selectedOptions).map((opt) => opt.value);
        clientLogger.debug('Multi-select value converted', {
          fieldName: name,
          values: newValue,
        });
      }

      return {
        ...prevState,
        [name]: newValue,
      };
    });
  };

  /**
   * Resets the form to its initial state
   */
  const resetForm = () => {
    clientLogger.debug('Form reset', {
      fieldsCount: Object.keys(initialState).length,
    });
    setFormData(initialState);
  };

  /**
   * Sets a specific field in the form state
   *
   * @param name - The field name
   * @param value - The new value for the field
   *
   * @example
   * setField('name', 'John Doe')
   * setField('age', 25)
   * setField('acceptTerms', true)
   */
  const setField = (name: keyof T, value: T[keyof T]) => {
    clientLogger.debug('Form field set', {
      fieldName: String(name),
      valueType: typeof value,
    });

    setFormData((prevState) => ({
      ...prevState,
      [name]: value,
    }));
  };

  return {
    formData,
    setFormData,
    handleChange,
    resetForm,
    setField,
  };
}
