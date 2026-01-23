'use client'

interface ProviderIconProps {
  provider: string
  className?: string
}

// Provider-specific icons
const PROVIDER_ICONS: Record<string, { color: string; abbrev: string }> = {
  OPENAI: { color: 'text-green-600', abbrev: 'OAI' },
  GROK: { color: 'text-purple-600', abbrev: 'XAI' },
  GOOGLE_IMAGEN: { color: 'text-blue-600', abbrev: 'GGL' },
  GOOGLE: { color: 'text-blue-600', abbrev: 'GGL' },
  OPENROUTER: { color: 'text-orange-600', abbrev: 'OR' },
  ETERNAL_AI: { color: 'text-purple-600', abbrev: 'EAI' },
}

export function ProviderIcon({ provider, className = 'h-5 w-5' }: ProviderIconProps) {
  const iconInfo = PROVIDER_ICONS[provider] || { color: 'text-gray-600', abbrev: provider.slice(0, 3).toUpperCase() }

  return (
    <svg
      className={`${iconInfo.color} ${className}`}
      fill="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="12" />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="white"
        fontSize={iconInfo.abbrev.length > 3 ? '9' : '10'}
        fontWeight="bold"
      >
        {iconInfo.abbrev}
      </text>
    </svg>
  )
}

// Provider badge colors and labels
const PROVIDER_BADGES: Record<string, { bg: string; text: string; label: string }> = {
  OPENAI: { bg: 'bg-green-100', text: 'text-green-800', label: 'OpenAI' },
  GROK: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Grok' },
  GOOGLE_IMAGEN: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Google Imagen' },
  GOOGLE: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Google' },
  OPENROUTER: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'OpenRouter' },
  ETERNAL_AI: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Eternal AI' },
}

export function ProviderBadge({ provider }: { provider: string }) {
  const badge = PROVIDER_BADGES[provider] || { bg: 'bg-gray-100', text: 'text-gray-800', label: provider }

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
      <ProviderIcon provider={provider} className="h-3 w-3" />
      {badge.label}
    </span>
  )
}
