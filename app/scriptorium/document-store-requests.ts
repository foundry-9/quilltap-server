/**
 * The Scriptorium's writes to a document store, stated once for the store
 * list (`hooks/useDocumentStores`) and the store page
 * (`[id]/hooks/useDocumentStoreDetail`).
 *
 * Each request goes through `apiFetch`, so a refusal throws an
 * `ApiFetchError` whose `apiErrorMessage` is the server's own sentence (a
 * taken name, a conversion already running). What each caller does to the
 * cache around a request — an optimistic status, a re-read — stays the
 * caller's. Plain functions: no React state lives here.
 *
 * @module app/scriptorium/document-store-requests
 */

import { apiFetch } from '@/lib/query/fetcher'
import type {
  ConvertResult,
  CreateDocumentStoreData,
  DeconvertResult,
  DocumentStore,
  ScanResult,
  UpdateDocumentStoreData,
} from './types'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

const storeUrl = (id: string, action?: string): string =>
  `/api/v1/mount-points/${encodeURIComponent(id)}${action ? `?action=${action}` : ''}`

/** What a scan answers. */
export interface ScanResponse {
  scanResult: ScanResult
  embeddingJobsEnqueued: number
}

/** Create a store. `warning` is set when it was made but something needs attention. */
export function createDocumentStore(data: CreateDocumentStoreData) {
  return apiFetch<{ mountPoint: DocumentStore; warning?: string }>('/api/v1/mount-points', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  })
}

/** Edit a store's settings. */
export function updateDocumentStore<T = DocumentStore>(id: string, data: UpdateDocumentStoreData) {
  return apiFetch<{ mountPoint: T }>(storeUrl(id), {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  })
}

export function deleteDocumentStore(id: string) {
  return apiFetch(storeUrl(id), { method: 'DELETE' })
}

export function scanDocumentStore(id: string) {
  return apiFetch<ScanResponse>(storeUrl(id, 'scan'), { method: 'POST' })
}

export function convertDocumentStore(id: string) {
  return apiFetch<{ convertResult: ConvertResult; previousBasePath?: string }>(storeUrl(id, 'convert'), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({}),
  })
}

export function deconvertDocumentStore(id: string, targetPath: string) {
  return apiFetch<{ deconvertResult: DeconvertResult }>(storeUrl(id, 'deconvert'), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ targetPath }),
  })
}

/** The toast after a scan. */
export function scanCompleteMessage(result: ScanResponse): string {
  return `Scan complete: ${result.scanResult.filesScanned} files scanned, ${result.embeddingJobsEnqueued} embedding jobs queued`
}
