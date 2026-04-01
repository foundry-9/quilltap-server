'use client'

import { useMemo } from 'react'

/**
 * Icon data structure that can be provided by plugins
 */
export interface PluginIconData {
  /** Raw SVG string (complete <svg> element) */
  svg?: string
  /** SVG viewBox attribute */
  viewBox?: string
  /** SVG path elements */
  paths?: Array<{
    d: string
    fill?: string
    stroke?: string
    strokeWidth?: string
    opacity?: string
    fillRule?: 'nonzero' | 'evenodd'
  }>
  /** SVG circle elements */
  circles?: Array<{
    cx: string | number
    cy: string | number
    r: string | number
    fill?: string
    stroke?: string
    strokeWidth?: string
    opacity?: string
  }>
  /** SVG text element */
  text?: {
    content: string
    x?: string
    y?: string
    fontSize?: string
    fontWeight?: string
    fill?: string
  }
}

interface ProviderIconProps {
  provider: string
  className?: string
  /** Custom icon data from plugin (optional) */
  iconData?: PluginIconData
  /** Override abbreviation (optional) */
  abbreviation?: string
  /** Override color class (optional) */
  colorClass?: string
}

// Provider-specific defaults (used when no custom icon data provided)
const PROVIDER_DEFAULTS: Record<string, { color: string; abbrev: string }> = {
  OPENAI: { color: 'text-green-600', abbrev: 'OAI' },
  GROK: { color: 'text-purple-600', abbrev: 'XAI' },
  GOOGLE_IMAGEN: { color: 'text-blue-600', abbrev: 'GGL' },
  GOOGLE: { color: 'text-blue-600', abbrev: 'GGL' },
  OPENROUTER: { color: 'text-orange-600', abbrev: 'OR' },
  ETERNAL_AI: { color: 'text-purple-600', abbrev: 'EAI' },
  ANTHROPIC: { color: 'text-amber-600', abbrev: 'ANT' },
  OLLAMA: { color: 'text-gray-600', abbrev: 'OLL' },
  OPENAI_COMPATIBLE: { color: 'text-slate-600', abbrev: 'OAC' },
}

/**
 * Renders a custom SVG icon from plugin icon data
 */
function CustomIcon({ iconData, className, colorClass }: {
  iconData: PluginIconData
  className: string
  colorClass: string
}) {
  // If raw SVG string is provided, render it directly
  if (iconData.svg) {
    // Parse the SVG and inject className
    // Note: dangerouslySetInnerHTML is safe here as we control the plugin source
    return (
      <span
        className={`${colorClass} ${className} inline-block`}
        dangerouslySetInnerHTML={{ __html: iconData.svg }}
      />
    )
  }

  // If structured data is provided, build the SVG
  if (iconData.viewBox && (iconData.paths || iconData.circles || iconData.text)) {
    return (
      <svg
        className={`${colorClass} ${className}`}
        viewBox={iconData.viewBox}
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
      >
        {iconData.circles?.map((circle, i) => (
          <circle
            key={`circle-${i}`}
            cx={circle.cx}
            cy={circle.cy}
            r={circle.r}
            fill={circle.fill}
            stroke={circle.stroke}
            strokeWidth={circle.strokeWidth}
            opacity={circle.opacity}
          />
        ))}
        {iconData.paths?.map((path, i) => (
          <path
            key={`path-${i}`}
            d={path.d}
            fill={path.fill}
            stroke={path.stroke}
            strokeWidth={path.strokeWidth}
            opacity={path.opacity}
            fillRule={path.fillRule}
          />
        ))}
        {iconData.text && (
          <text
            x={iconData.text.x || '50%'}
            y={iconData.text.y || '50%'}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={iconData.text.fill || 'white'}
            fontSize={iconData.text.fontSize || '10'}
            fontWeight={iconData.text.fontWeight || 'bold'}
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            {iconData.text.content}
          </text>
        )}
      </svg>
    )
  }

  return null
}

/**
 * Default circle icon with abbreviation text
 */
function DefaultIcon({ abbreviation, className, colorClass }: {
  abbreviation: string
  className: string
  colorClass: string
}) {
  return (
    <svg
      className={`${colorClass} ${className}`}
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
        fontSize={abbreviation.length > 3 ? '9' : '10'}
        fontWeight="bold"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {abbreviation}
      </text>
    </svg>
  )
}

export function ProviderIcon({
  provider,
  className = 'h-5 w-5',
  iconData,
  abbreviation,
  colorClass,
}: ProviderIconProps) {
  const defaults = PROVIDER_DEFAULTS[provider] || {
    color: 'text-gray-600',
    abbrev: provider.slice(0, 3).toUpperCase()
  }

  const finalColorClass = colorClass || defaults.color
  const finalAbbreviation = abbreviation || defaults.abbrev

  // If custom icon data is provided, try to render it
  if (iconData) {
    const customIcon = (
      <CustomIcon
        iconData={iconData}
        className={className}
        colorClass={finalColorClass}
      />
    )
    if (customIcon) {
      return customIcon
    }
  }

  // Fall back to default circle + abbreviation icon
  return (
    <DefaultIcon
      abbreviation={finalAbbreviation}
      className={className}
      colorClass={finalColorClass}
    />
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
  ANTHROPIC: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Anthropic' },
  OLLAMA: { bg: 'bg-gray-100', text: 'text-gray-800', label: 'Ollama' },
  OPENAI_COMPATIBLE: { bg: 'bg-slate-100', text: 'text-slate-800', label: 'OpenAI Compatible' },
}

export function ProviderBadge({
  provider,
  iconData,
  label,
}: {
  provider: string
  iconData?: PluginIconData
  label?: string
}) {
  const badge = PROVIDER_BADGES[provider] || { bg: 'bg-gray-100', text: 'text-gray-800', label: provider }
  const finalLabel = label || badge.label

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
      <ProviderIcon provider={provider} className="h-3 w-3" iconData={iconData} />
      {finalLabel}
    </span>
  )
}
