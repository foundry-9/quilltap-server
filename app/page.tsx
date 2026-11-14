import { redirectToWorkspaceTab } from "@/lib/navigation/workspace-redirect";

// Never pre-render during build: the landing redirect happens per request.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function Home() {
  // The tabbed workspace is the post-login landing surface.
  return redirectToWorkspaceTab('home');
}
