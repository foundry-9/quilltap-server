'use client'

import { useState, useCallback } from 'react'
import { fetchJson } from '@/lib/fetch-helpers'

/**
 * Parsed storage key components
 */
export interface ParsedStorageKey {
  userId: string
  projectId: string | null
  folderPath: string
  fileId: string | null
  filename: string
}

/**
 * Orphan file information
 */
export interface OrphanFile {
  storageKey: string
  size: number
  lastModified?: string
  mimeType: string
  parsed: ParsedStorageKey | null
}

/**
 * Scan result from the API
 */
export interface ScanOrphansResult {
  mountPointId: string
  mountPointName: string
  scannedAt: string
  totalFilesInStorage: number
  totalFilesInDatabase: number
  orphans: OrphanFile[]
  errors: string[]
}

/**
 * Adoption result from the API
 */
export interface AdoptOrphansResult {
  adopted: number
  failed: Array<{ storageKey: string; error: string }>
  files: unknown[]
}

interface UseOrphanScanResult {
  scanning: boolean
  adopting: boolean
  scanResult: ScanOrphansResult | null
  adoptResult: AdoptOrphansResult | null
  error: string | null
  scanForOrphans: (mountPointId: string) => Promise<ScanOrphansResult | null>
  adoptOrphans: (mountPointId: string, storageKeys: string[], computeHashes?: boolean) => Promise<AdoptOrphansResult | null>
  clearResults: () => void
}

/**
 * Hook to manage orphan file scanning and adoption
 */
export function useOrphanScan(): UseOrphanScanResult {
  const [scanning, setScanning] = useState(false)
  const [adopting, setAdopting] = useState(false)
  const [scanResult, setScanResult] = useState<ScanOrphansResult | null>(null)
  const [adoptResult, setAdoptResult] = useState<AdoptOrphansResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const scanForOrphans = useCallback(async (mountPointId: string): Promise<ScanOrphansResult | null> => {
    setScanning(true)
    setError(null)
    setScanResult(null)
    setAdoptResult(null)

    try {

      const result = await fetchJson<ScanOrphansResult>(`/api/v1/system/mount-points/${mountPointId}?action=scan-orphans`, {
        method: 'POST',
      })

      if (!result.ok) {
        throw new Error(result.error || 'Failed to scan for orphans')
      }

      if (result.data) {
        setScanResult(result.data)
        return result.data
      }

      return null
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to scan for orphans'
      console.error('Failed to scan for orphans', { mountPointId, error: errorMessage })
      setError(errorMessage)
      return null
    } finally {
      setScanning(false)
    }
  }, [])

  const adoptOrphans = useCallback(async (
    mountPointId: string,
    storageKeys: string[],
    computeHashes = false
  ): Promise<AdoptOrphansResult | null> => {
    setAdopting(true)
    setError(null)
    setAdoptResult(null)

    try {

      const result = await fetchJson<AdoptOrphansResult>(`/api/v1/system/mount-points/${mountPointId}?action=adopt-orphans`, {
        method: 'POST',
        body: JSON.stringify({
          storageKeys,
          computeHashes,
          source: 'IMPORTED',
        }),
      })

      if (!result.ok) {
        throw new Error(result.error || 'Failed to adopt orphan files')
      }

      if (result.data) {
        setAdoptResult(result.data)

        // Update scan result to remove adopted files
        if (scanResult) {
          const adoptedKeys = new Set(storageKeys)
          const remainingOrphans = scanResult.orphans.filter(o => !adoptedKeys.has(o.storageKey))
          setScanResult({
            ...scanResult,
            orphans: remainingOrphans,
          })
        }

        return result.data
      }

      return null
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to adopt orphan files'
      console.error('Failed to adopt orphan files', { mountPointId, error: errorMessage })
      setError(errorMessage)
      return null
    } finally {
      setAdopting(false)
    }
  }, [scanResult])

  const clearResults = useCallback(() => {
    setScanResult(null)
    setAdoptResult(null)
    setError(null)
  }, [])

  return {
    scanning,
    adopting,
    scanResult,
    adoptResult,
    error,
    scanForOrphans,
    adoptOrphans,
    clearResults,
  }
}
