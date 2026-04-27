import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from '@jest/globals'

const apiRoot = path.join(process.cwd(), 'app', 'api')

const allowedLegacyRoutes = new Set([
  'health/route.ts',
  'plugin-routes/[...path]/route.ts',
  'themes/assets/[...path]/route.ts',
  'themes/fonts/[...path]/route.ts',
])

function collectRouteFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    if (entry.name === '.DS_Store') {
      continue
    }

    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectRouteFiles(fullPath))
      continue
    }

    if (entry.isFile() && entry.name === 'route.ts') {
      files.push(path.relative(apiRoot, fullPath))
    }
  }

  return files
}

describe('API route versioning conventions', () => {
  it('keeps route handlers on /api/v{version}/{entityname} with explicit legacy exceptions', () => {
    const routeFiles = collectRouteFiles(apiRoot)

    for (const routeFile of routeFiles) {
      const versionedMatch = routeFile.match(/^v\d+\/(.+)\/route\.ts$/)
      if (versionedMatch) {
        const versionedRoutePath = versionedMatch[1]
        const [entityName] = versionedRoutePath.split('/')

        expect(entityName).toBeDefined()
        // The first segment after the version should be a stable entity namespace.
        expect(entityName).toMatch(/^[a-z0-9-]+$/)
        continue
      }

      expect(allowedLegacyRoutes.has(routeFile)).toBe(true)
    }
  })
})