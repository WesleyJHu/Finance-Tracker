"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Signs out of this app (not out of Google).
 *
 * The tooltip names the signed-in account, since more than one person can
 * use the tracker and a shared browser does not say whose data it is showing.
 */
export default function SignOutButton({ className = "" }: { className?: string } = {}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && typeof data?.email === "string") setEmail(data.email);
      })
      // Cosmetic only: without it the button still works, just untitled.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = async () => {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      // Navigate either way: if the request failed the cookie may still be
      // set, and the middleware will send us back to the dashboard — which is
      // the honest outcome, rather than pretending we signed out.
      router.replace("/login");
      router.refresh();
    }
  };

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={loading}
      title={email ? `Signed in as ${email}` : undefined}
      className={`rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {loading ? "Signing out..." : "Sign out"}
    </button>
  );
}
