/**
 * Authenticated Layout (Single-User Mode)
 *
 * In single-user mode, simply render children.
 * No authentication check is needed as there is always a single user.
 */

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
