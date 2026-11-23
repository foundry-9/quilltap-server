'use client'

/**
 * Refused themes
 *
 * Lists the themes Quilltap found but would not wear: version 1 bundles among
 * the installed themes, and themes a plugin declared. Each shows the refusal's
 * own explanation and a way to the Themes help page; an installed bundle can
 * be uninstalled from here. Nothing is removed unless the operator asks.
 *
 * @module components/settings/appearance/components/RefusedThemes
 */

import type { RefusedTheme } from '@/lib/themes/refused'
import { useHelpChatOptional } from '@/components/providers/help-chat-provider'
import { Icon } from '@/components/ui/icon'

interface RefusedThemesProps {
  refused: RefusedTheme[]
  onUninstall: (themeId: string) => void
  disabled?: boolean
}

export function RefusedThemes({ refused, onUninstall, disabled = false }: RefusedThemesProps) {
  const help = useHelpChatOptional()
  if (refused.length === 0) return null

  return (
    <section className="mt-6" aria-labelledby="refused-themes-heading">
      <h3 id="refused-themes-heading" className="qt-section-title mb-2">
        Garments Left at the Door
      </h3>
      <ul className="space-y-3">
        {refused.map((theme) => (
          <li key={`${theme.source}:${theme.id}`} className="qt-alert qt-alert-warning text-sm">
            <div className="flex items-start gap-3">
              <Icon name="alert-triangle" className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-medium">
                  {theme.name}
                  <span className="ml-2 qt-text-small opacity-80">
                    {theme.source === 'plugin' && theme.pluginName
                      ? `from the plugin ${theme.pluginName}`
                      : `version ${theme.version}`}
                  </span>
                </p>
                <p className="mt-1">{theme.message}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {help && (
                    <button
                      type="button"
                      onClick={help.openHelpChat}
                      className="qt-button-secondary qt-button-sm"
                    >
                      Read the Themes help page
                    </button>
                  )}
                  {theme.source === 'bundle' && (
                    <button
                      type="button"
                      onClick={() => onUninstall(theme.id)}
                      disabled={disabled}
                      className="qt-button-destructive qt-button-sm"
                    >
                      Uninstall
                    </button>
                  )}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
