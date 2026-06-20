/**
 * ScenariosIcon — thin wrapper around the centralized scenarios icon.
 * Used everywhere Scenarios lives in the UI (project ScenariosCard header,
 * /scenarios page chrome, the left sidebar nav entry).
 *
 * @module components/scenarios/ScenariosIcon
 */

import { Icon } from '@/components/ui/icon'

export function ScenariosIcon({ className }: { className?: string }) {
  return <Icon name="scenarios" className={className} />
}
