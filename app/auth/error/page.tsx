"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function ErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  return (
    <div className="qt-alert-error">
      {error === "Configuration" && "There is a problem with the server configuration."}
      {error === "AccessDenied" && "You do not have permission to sign in."}
      {error === "Verification" && "The sign in link is no longer valid."}
      {!error && "An unknown error occurred."}
    </div>
  );
}

export default function AuthError() {
  return (
    <div className="qt-auth-page">
      <div className="qt-auth-card">
        <div className="qt-auth-header">
          <h1 className="qt-auth-title text-destructive">Authentication Error</h1>
          <p className="qt-auth-subtitle">
            Something went wrong during sign in
          </p>
        </div>

        <Suspense fallback={
          <div className="qt-alert-error">Loading...</div>
        }>
          <ErrorContent />
        </Suspense>

        <div className="text-center">
          <Link href="/auth/signin" className="qt-link font-semibold">
            Try again
          </Link>
        </div>
      </div>
    </div>
  );
}
