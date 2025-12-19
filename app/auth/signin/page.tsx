"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { BrandName } from "@/components/ui/brand-name";
import { getErrorMessage } from "@/lib/error-utils";

interface AuthProvider {
  id: string;
  name: string;
  icon?: string;
  buttonColor?: string;
  buttonTextColor?: string;
}

interface AuthStatus {
  authDisabled: boolean;
  hasOAuthProviders: boolean;
  providers: AuthProvider[];
  credentialsEnabled: boolean;
  warning: string | null;
}

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const message = searchParams.get("message");
  const errorParam = searchParams.get("error");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [error, setError] = useState(errorParam || "");
  const [loading, setLoading] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [authStatusLoading, setAuthStatusLoading] = useState(true);

  // Fetch auth status on mount
  useEffect(() => {
    async function fetchAuthStatus() {
      try {
        const response = await fetch('/api/auth/status');
        if (response.ok) {
          const data = await response.json();
          setAuthStatus(data);
        }
      } catch (err) {
        console.error('Failed to fetch auth status:', err);
      } finally {
        setAuthStatusLoading(false);
      }
    }
    fetchAuthStatus();
  }, []);

  async function handleCredentialsSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Get trusted device token from cookie if available
      const trustedDeviceToken = document.cookie
        .split('; ')
        .find(row => row.startsWith('totp_trusted_device='))
        ?.split('=')[1];

      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          username,
          password,
          totpCode: needsTotp ? totpCode : undefined,
          trustedDeviceToken: trustedDeviceToken || undefined,
          rememberDevice,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        if (result.requires2FA) {
          setNeedsTotp(true);
          setError("Please enter your 2FA code");
        } else {
          setError(result.error || "Login failed");
        }
      } else {
        // Login successful - if TOTP was verified and remember device is checked, create trusted device
        if (needsTotp && rememberDevice && totpCode) {
          try {
            await fetch('/api/auth/2fa/trusted-devices', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
            });
          } catch (deviceErr) {
            // Don't block login if device trust fails
            console.error('Failed to create trusted device:', deviceErr);
          }
        }
        router.push("/dashboard");
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, "An error occurred"));
    } finally {
      setLoading(false);
    }
  }

  function handleOAuthSignIn(providerId: string) {
    // Redirect to Arctic OAuth authorization endpoint
    const callbackUrl = encodeURIComponent("/dashboard");
    window.location.href = `/api/auth/oauth/${providerId}/authorize?callbackUrl=${callbackUrl}`;
  }

  // Render Google icon SVG
  function renderProviderIcon(provider: AuthProvider) {
    if (provider.id === 'google') {
      return (
        <svg className="h-5 w-5" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
      );
    }
    // Default icon for other providers
    return (
      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
      </svg>
    );
  }

  return (
    <div className="qt-auth-page">
      <div className="qt-auth-card">
        <div className="qt-auth-header">
          <h1 className="qt-auth-title">Sign In</h1>
          <p className="qt-auth-subtitle">
            Welcome back to <BrandName />
          </p>
        </div>

        {message && (
          <div className="qt-alert-success">
            {message}
          </div>
        )}

        {error && (
          <div className="qt-alert-error">
            {error}
          </div>
        )}

        {/* Warning when no OAuth providers configured */}
        {authStatus?.warning && (
          <div className="qt-alert-warning">
            {authStatus.warning}
          </div>
        )}

        <div className="mt-8 space-y-4">
          {/* OAuth Provider Buttons - dynamically rendered */}
          {authStatusLoading ? (
            <div className="qt-button qt-button-secondary w-full justify-center opacity-70">
              Loading authentication options...
            </div>
          ) : (
            authStatus?.providers.map((provider) => (
              <button
                key={provider.id}
                onClick={() => handleOAuthSignIn(provider.id)}
                className="qt-button qt-button-secondary w-full justify-center"
              >
                {renderProviderIcon(provider)}
                Continue with {provider.name}
              </button>
            ))
          )}

          {/* Divider - only show if there are OAuth providers */}
          {authStatus?.hasOAuthProviders && (
            <div className="qt-auth-divider">
              <div className="qt-auth-divider-line" />
              <div className="qt-auth-divider-text">
                <span>Or</span>
              </div>
            </div>
          )}

          <form onSubmit={handleCredentialsSignIn} className="qt-auth-form">
            <div className="qt-auth-field">
              <label htmlFor="username" className="qt-auth-label">
                Username
              </label>
              <input
                id="username"
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="qt-input mt-1"
                placeholder="your_username"
              />
            </div>

            <div className="qt-auth-field">
              <label htmlFor="password" className="qt-auth-label">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="qt-input mt-1"
                placeholder="••••••••"
              />
            </div>

            {needsTotp && (
              <>
                <div className="qt-auth-field">
                  <label htmlFor="totpCode" className="qt-auth-label">
                    2FA Code
                  </label>
                  <input
                    id="totpCode"
                    type="text"
                    required
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="000000"
                    className="qt-input mt-1"
                  />
                  <p className="qt-auth-hint">
                    Enter code from your authenticator app, or use a backup code
                  </p>
                </div>

                <div className="flex items-center">
                  <input
                    id="rememberDevice"
                    type="checkbox"
                    checked={rememberDevice}
                    onChange={(e) => setRememberDevice(e.target.checked)}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <label htmlFor="rememberDevice" className="ml-2 qt-text-small">
                    Remember this device for 30 days
                  </label>
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={loading}
              className="qt-button qt-button-primary w-full"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>

          <p className="qt-auth-footer">
            Don&apos;t have an account?{" "}
            <Link href="/auth/signup" className="qt-link font-medium">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="qt-auth-page text-white">Loading...</div>}>
      <SignInForm />
    </Suspense>
  );
}
