/**
 * Deprecated path — use `/api/v1/wardrobe?action=analyze-image` (GET and POST).
 * Answers for one release (`lib/api/deprecated-path.ts`).
 */
import { createContextHandler } from '@/lib/api/middleware';
import { deprecatedPath } from '@/lib/api/deprecated-path';
import { handleAnalyzeImage, handleAnalyzeImageProfiles } from '@/lib/wardrobe/routes/analyze-image';

const REPLACEMENT = '/api/v1/wardrobe?action=analyze-image';
export const GET = createContextHandler(deprecatedPath('/api/v1/wardrobe/analyze-image', REPLACEMENT, handleAnalyzeImageProfiles));
export const POST = createContextHandler(deprecatedPath('/api/v1/wardrobe/analyze-image', REPLACEMENT, handleAnalyzeImage));
