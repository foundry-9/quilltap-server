/**
 * Authenticated Layout (Single-User Mode)
 *
 * Passthrough layout for authenticated pages.
 * HelpChatProvider is mounted in AppLayout so the sidebar can access it.
 */

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
