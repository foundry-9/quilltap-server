import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "@/lib/auth/session";
import { BrandLogo } from "@/components/ui/brand-logo";

export default async function Home() {
  const session = await getServerSession();

  if (session) {
    redirect("/dashboard");
  }

  return (
    <main className="qt-auth-page p-24">
      <div className="text-center">
        <h1 className="text-white mb-4 flex flex-col items-center">
          <span className="sr-only">Welcome to Quilltap</span>
          <span className="text-2xl font-medium mb-2 font-brand">Welcome to</span>
          <BrandLogo size="xl" />
        </h1>
        <p className="text-xl text-slate-300 mb-8 font-brand">
          AI-powered roleplay chat platform with multi-provider support
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/auth/signin"
            className="qt-button-primary qt-button-lg shadow-lg"
          >
            Get Started
          </Link>
          <a
            href="https://github.com/foundry-9/quilltap"
            target="_blank"
            rel="noopener noreferrer"
            className="qt-button-secondary qt-button-lg shadow-lg"
          >
            Learn More
          </a>
        </div>
      </div>
    </main>
  );
}
