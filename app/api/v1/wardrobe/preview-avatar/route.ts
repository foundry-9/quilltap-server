/**
 * Deprecated path — use `POST /api/v1/wardrobe?action=preview-avatar`.
 * Answers for one release (`lib/api/deprecated-path.ts`).
 */
import { createContextHandler } from '@/lib/api/middleware';
import { deprecatedPath } from '@/lib/api/deprecated-path';
import { handlePreviewAvatarAction } from '@/lib/wardrobe/routes/preview-avatar';

export const POST = createContextHandler(
  deprecatedPath('/api/v1/wardrobe/preview-avatar', '/api/v1/wardrobe?action=preview-avatar', handlePreviewAvatarAction),
);
