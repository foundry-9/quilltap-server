/**
 * Regression: toasts raised from inside a dialog were hidden behind it.
 *
 * The toast container sat at z-index 50, below every dialog overlay
 * (z-[60] … z-[101]), so an error toast from a save inside a modal appeared
 * behind the modal. The container must stack above every dialog layer the app
 * declares, and below the full-screen startup gates at z-[9999].
 */

import { readdirSync, readFileSync, statSync } from 'fs'
import path from 'path'
import { showErrorToast } from '@/lib/toast'

const STARTUP_GATE_Z = 9999
const ROOT = path.resolve(__dirname, '../../..')

function collectZIndices(dir: string, found: number[] = []): number[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      collectZIndices(full, found)
    } else if (/\.(tsx?|css)$/.test(entry) && !/\.(test|stories)\./.test(entry)) {
      const text = readFileSync(full, 'utf8')
      for (const m of text.matchAll(/\bz-\[(\d+)\]/g)) found.push(Number(m[1]))
      for (const m of text.matchAll(/z-index:\s*(\d+)/g)) found.push(Number(m[1]))
    }
  }
  return found
}

describe('toast stacking order', () => {
  it('puts the toast container above every dialog layer and below the startup gates', () => {
    showErrorToast('Saving failed', 60_000)

    const container = document.querySelector<HTMLDivElement>('[role="toast-container"]')
    expect(container).not.toBeNull()
    const toastZ = Number(container!.style.zIndex)

    const dialogLayers = [
      ...collectZIndices(path.join(ROOT, 'components')),
      ...collectZIndices(path.join(ROOT, 'app')),
    ].filter((z) => z < STARTUP_GATE_Z)

    expect(dialogLayers.length).toBeGreaterThan(0)
    expect(toastZ).toBeGreaterThan(Math.max(...dialogLayers))
    expect(toastZ).toBeLessThan(STARTUP_GATE_Z)
  })
})
