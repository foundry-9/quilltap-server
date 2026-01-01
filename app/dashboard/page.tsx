import { redirect } from "next/navigation";

/**
 * Dashboard Page
 *
 * This page now redirects to the home page.
 * The dashboard functionality has been moved to the home page.
 *
 * @deprecated Use the home page (/) instead
 */
export default function Dashboard() {
  redirect('/');
}
