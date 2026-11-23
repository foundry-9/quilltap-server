/**
 * Serving a draft's assets and fonts through the ordinary theme asset and
 * font routes (Spec D, decisions 9 and 10).
 *
 * A draft's compiled CSS points at `/api/themes/{assets,fonts}/bundle:<id>/…?v=<version>`,
 * the same URLs an installed bundle uses. The routes ask the registry first:
 * an installed theme answers when its version is the one asked for, or when
 * no version is given. Otherwise a draft of that id at that exact version
 * answers here — only from its served set, read from the store, and never
 * cached for long, since a draft's files change under the same URL.
 *
 * @module lib/themes/drafts/serve
 */

import path from 'node:path';
import { NextResponse } from 'next/server';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { serveStoredBytes } from '@/lib/api/serve-stored-bytes';
import { normaliseBundlePath } from '../engine/css-text';
import { isValidDraftId } from './location';
import { draftServedSet, readDraftServedFile } from './service';

const logger = createServiceLogger('ThemeDraftServe');

/** True when an installed theme of this version should answer rather than a draft. */
export function registryAnswers(installedVersion: string | undefined, requestedVersion: string | null): boolean {
  return installedVersion !== undefined && (requestedVersion === null || requestedVersion === installedVersion);
}

/**
 * Serve `file` of draft `themeId` at `version`, or null when no draft of that
 * id and version has it in its served set (the route then falls back to the
 * registry, or a 404).
 */
export async function serveDraftThemeFile(input: {
  themeId: string;
  file: string;
  kind: 'asset' | 'font';
  version: string | null;
  mimeTypes: Readonly<Record<string, string>>;
}): Promise<NextResponse | null> {
  const { themeId, kind, version } = input;
  if (version === null || !isValidDraftId(themeId)) return null;
  let served;
  try {
    served = await draftServedSet(themeId);
  } catch (error) {
    logger.warn('Theme draft served set unavailable', { themeId, error: (error as Error).message });
    return null;
  }
  if (!served || served.version !== version) return null;

  const file = normaliseBundlePath(input.file);
  const allowed = kind === 'font' ? served.fonts : served.assets;
  if (!allowed.has(file)) {
    logger.debug('Theme draft file not in the served set', { themeId, kind, file });
    return null;
  }
  const mimeType = input.mimeTypes[path.extname(file).toLowerCase()];
  if (!mimeType) {
    logger.debug('Theme draft file type not served', { themeId, kind, file });
    return null;
  }
  try {
    const data = await readDraftServedFile(themeId, file);
    logger.debug('Serving theme draft file', { themeId, kind, file, bytes: data.length });
    return serveStoredBytes(new Uint8Array(data), {
      mimeType,
      filename: path.posix.basename(file),
      cacheControl: 'no-cache',
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw error;
  }
}
