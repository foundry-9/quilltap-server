"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BrandName } from "@/components/ui/brand-name";

export default function SignupPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/v1/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, name }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.details && Array.isArray(data.details)) {
          setError(data.details.join(", "));
        } else {
          setError(data.error || "Signup failed");
        }
        return;
      }

      router.push("/auth/signin?message=Account created. Please sign in.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An error occurred";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="qt-auth-page">
      <div className="qt-auth-card">
        <div className="qt-auth-header">
          <h1 className="qt-auth-title">Create Account</h1>
          <p className="qt-auth-subtitle">
            Join <BrandName /> to start your AI roleplay journey
          </p>
        </div>

        {error && (
          <div className="qt-alert-error">
            {error}
          </div>
        )}

        <form onSubmit={handleSignup} className="qt-auth-form mt-8">
          <div className="qt-auth-field">
            <label htmlFor="name" className="qt-auth-label">
              Name (optional)
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="qt-input mt-1"
              placeholder="Your name"
            />
          </div>

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
            <p className="qt-auth-hint">
              Must be 3-50 characters
            </p>
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
            <p className="qt-auth-hint">
              Must be at least 8 characters with uppercase, lowercase, number,
              and special character
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="qt-button qt-button-primary w-full"
          >
            {loading ? "Creating account..." : "Sign Up"}
          </button>
        </form>

        <p className="qt-auth-footer">
          Already have an account?{" "}
          <Link href="/auth/signin" className="qt-link font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
