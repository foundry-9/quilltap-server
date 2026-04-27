/**
 * Unified diff helpers for Scriptorium document editing.
 *
 * Keeps autosave notifications and other document-mode change summaries
 * consistent across the app.
 */

/**
 * Generate a simple unified diff between two strings.
 * Produces output similar to git diff with @@ line markers.
 */
export function generateUnifiedDiff(oldText: string, newText: string, filename: string): string {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const hunks: string[] = []

  let i = 0
  let j = 0

  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++
      j++
      continue
    }

    const hunkStartOld = i + 1
    const hunkStartNew = j + 1
    const removedLines: string[] = []
    const addedLines: string[] = []
    const lookAhead = 3

    while (i < oldLines.length || j < newLines.length) {
      if (i < oldLines.length && j < newLines.length) {
        let foundInNew = -1
        for (let k = j; k < Math.min(j + lookAhead, newLines.length); k++) {
          if (oldLines[i] === newLines[k]) {
            foundInNew = k
            break
          }
        }

        let foundInOld = -1
        for (let k = i; k < Math.min(i + lookAhead, oldLines.length); k++) {
          if (newLines[j] === oldLines[k]) {
            foundInOld = k
            break
          }
        }

        if (foundInNew === j && foundInOld === i) {
          break
        }

        if (foundInNew >= 0 && (foundInOld < 0 || foundInNew - j <= foundInOld - i)) {
          while (j < foundInNew) {
            addedLines.push(newLines[j])
            j++
          }
          removedLines.push(oldLines[i])
          i++
          continue
        }

        if (foundInOld >= 0) {
          while (i < foundInOld) {
            removedLines.push(oldLines[i])
            i++
          }
          addedLines.push(newLines[j])
          j++
          continue
        }
      }

      if (i < oldLines.length) {
        removedLines.push(oldLines[i])
        i++
      }
      if (j < newLines.length) {
        addedLines.push(newLines[j])
        j++
      }

      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        break
      }
    }

    if (removedLines.length > 0 || addedLines.length > 0) {
      hunks.push(`@@ -${hunkStartOld},${removedLines.length} +${hunkStartNew},${addedLines.length} @@`)
      for (const line of removedLines) hunks.push(`-${line}`)
      for (const line of addedLines) hunks.push(`+${line}`)
    }
  }

  if (hunks.length === 0) {
    return ''
  }

  return `--- a/${filename}\n+++ b/${filename}\n${hunks.join('\n')}`
}

export function formatAutosaveNotification(oldText: string, newText: string, filename: string): string | null {
  const diff = generateUnifiedDiff(oldText, newText, filename)

  if (!diff) {
    return null
  }

  return `I've made changes to "${filename}":\n\n\`\`\`diff\n${diff}\n\`\`\``
}
