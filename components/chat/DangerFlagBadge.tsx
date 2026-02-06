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
              ? 'bg-muted text-muted-foreground line-through'
              : 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200'
          }`}
          title={`Score: ${flag.score.toFixed(2)}${flag.wasRerouted ? ' (rerouted)' : ''}`}
        >
          {CATEGORY_LABELS[flag.category] || flag.category}
        </span>
      ))}

      {wasRerouted && reroutedInfo && (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200"
          title={`Rerouted to ${reroutedInfo.reroutedProvider}/${reroutedInfo.reroutedModel}`}
        >
          Rerouted
        </span>
      )}

      {!allOverridden && onOverride && (
        <button
          onClick={onOverride}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-muted text-muted-foreground hover:bg-accent cursor-pointer"
          title="Mark as not dangerous"
        >
          Not Dangerous
        </button>
      )}
    </div>
  )
}
