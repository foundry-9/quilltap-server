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
      disabled={disabled}
      className="w-full px-3 py-2 border qt-border-default rounded-lg bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
    />
  )
}
