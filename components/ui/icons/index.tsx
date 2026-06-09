/**
 * Legacy shared-icon exports.
 *
 * @deprecated These are thin wrappers around the central <Icon> primitive,
 * kept only so the app-wide icon migration can proceed incrementally. Prefer
 * `import { Icon } from '@/components/ui/icon'` and `<Icon name="..." />`
 * directly. Each wrapper here will be removed once its call sites are migrated.
 *
 * @module components/ui/icons
 */

import { Icon } from '@/components/ui/icon';

interface IconProps {
  className?: string;
}

/** @deprecated Use `<Icon name="close" />`. */
export function CloseIcon({ className }: IconProps) {
  return <Icon name="close" className={className} />;
}

/** @deprecated Use `<Icon name="pencil" />`. */
export function PencilIcon({ className }: IconProps) {
  return <Icon name="pencil" className={className} />;
}

/** @deprecated Use `<Icon name="refresh" />`. */
export function RefreshIcon({ className }: IconProps) {
  return <Icon name="refresh" className={className} />;
}

/** @deprecated Use `<Icon name="check" />`. */
export function CheckIcon({ className }: IconProps) {
  return <Icon name="check" className={className} />;
}

/** @deprecated Use `<Icon name="chat" />`. */
export function ChatIcon({ className }: IconProps) {
  return <Icon name="chat" className={className} />;
}
