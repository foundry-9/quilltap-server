'use client'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  disabled?: boolean
}

/**
 * Search input for filtering entity lists in wizard dialogs
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  disabled = false,
}: SearchInputProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder || 'Search'}
      disabled={disabled}
      className="qt-input disabled:opacity-50"
    />
  )
}
