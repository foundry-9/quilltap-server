'use client'

interface DangerFlag {
  category: string
  score: number
  userOverridden: boolean
  wasRerouted: boolean
  reroutedProvider?: string | null
  reroutedModel?: string | null
}

interface DangerFlagBadgeProps {
  dangerFlags: DangerFlag[]
  onOverride?: () => void
}

const CATEGORY_LABELS: Record<string, string> = {
  nsfw: 'NSFW',
  violence: 'Violence',
  hate_speech: 'Hate Speech',
  self_harm: 'Self-Harm',
  illegal_activity: 'Illegal',
  disturbing: 'Disturbing',
}

export function DangerFlagBadge({ dangerFlags, onOverride }: DangerFlagBadgeProps) {
  if (!dangerFlags || dangerFlags.length === 0) return null

  const allOverridden = dangerFlags.every(f => f.userOverridden)
  const wasRerouted = dangerFlags.some(f => f.wasRerouted)
  const reroutedInfo = dangerFlags.find(f => f.wasRerouted && f.reroutedProvider)

  return (
    <div className="flex items-center gap-1.5 flex-wrap mt-1">
      {dangerFlags.map((flag, idx) => (
        <span
          key={`${flag.category}-${idx}`}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${
            flag.userOverridden
              ? 'qt-bg-muted qt-text-secondary line-through'
              : 'qt-bg-warning/10 qt-text-warning'
          }`}
          title={`Score: ${flag.score.toFixed(2)}${flag.wasRerouted ? ' (rerouted)' : ''}`}
        >
          {CATEGORY_LABELS[flag.category] || flag.category}
        </span>
      ))}

      {wasRerouted && reroutedInfo && (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs qt-bg-info/10 qt-text-info"
          title={`Rerouted to ${reroutedInfo.reroutedProvider}/${reroutedInfo.reroutedModel}`}
        >
          Rerouted
        </span>
      )}

      {!allOverridden && onOverride && (
        <button
          onClick={onOverride}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs qt-bg-muted qt-text-secondary hover:bg-accent cursor-pointer"
          title="Mark as not dangerous"
        >
          Not Dangerous
        </button>
      )}
    </div>
  )
}
