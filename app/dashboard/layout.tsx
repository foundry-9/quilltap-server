import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";

// Never pre-render during build - requires database access
export const dynamic = 'force-dynamic';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();

  if (!session) {
    redirect("/auth/signin");
  }

  return children;
}
