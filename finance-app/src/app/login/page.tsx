import React from "react";
import { readGoogleConfig, safeRedirectPath } from "@/lib/auth";
import { LOGIN_ERRORS, loginErrorMessage } from "@/lib/loginErrors";

// Reads AUTH_URL at request time, not build time: the image is built once and
// configured by its environment.
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The sign-in page: one "Sign in with Google" link, plus the reason the last
 * attempt failed, if it did.
 *
 * A server component so the link can be absolute, built from AUTH_URL. The
 * sign-in route sets its state cookie on whatever host it is reached on, and
 * Google always redirects back to AUTH_URL — so arriving here via the NAS's
 * LAN address and following a relative link would set the cookie on the
 * wrong host, and every attempt would come back "expired".
 */
export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeRedirectPath(first(params.next));
  const google = readGoogleConfig();

  const error = google.ok ? loginErrorMessage(first(params.error)) : LOGIN_ERRORS.not_configured;

  const signInHref = google.ok
    ? `${google.config.appUrl}/api/auth/google${next === "/" ? "" : `?next=${encodeURIComponent(next)}`}`
    : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-sm border border-slate-200">
        <h1 className="text-2xl font-bold text-slate-900">Finance Tracker</h1>
        <p className="mt-2 text-sm text-slate-500">Sign in with your Google account to continue.</p>

        {error && (
          <p role="alert" className="mt-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {signInHref ? (
          <a
            href={signInHref}
            className="mt-6 flex w-full items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200"
          >
            <GoogleMark />
            Sign in with Google
          </a>
        ) : (
          <p className="mt-6 text-sm text-slate-500">
            Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and AUTH_URL on the server. See
            finance-app/README.md.
          </p>
        )}
      </div>
    </main>
  );
}

/** Google's "G", as its sign-in branding guidelines ask buttons to show it. */
function GoogleMark() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
