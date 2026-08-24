"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Renders nothing when auth is switched off, so the development setup does not
 * show a control that cannot do anything.
 */
export default function SignOutButton({ className = "" }: { className?: string } = {}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (process.env.NEXT_PUBLIC_AUTH_DISABLED === "true") return null;

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
      className={`rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {loading ? "Signing out..." : "Sign out"}
    </button>
  );
}
