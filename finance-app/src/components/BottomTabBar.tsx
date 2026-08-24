"use client";

import Link from "next/link";

/**
 * The mobile navigation: a fixed, thumb-reachable tab bar shown below `md`,
 * where TabNav is hidden.
 *
 * Kept separate from TabNav rather than forked inside it because the two
 * render entirely different trees — underlined wide-tracked links versus
 * stacked icon+label cells — and TabNav's markup is the desktop layout, which
 * must not move.
 *
 * The icons are inline SVG rather than files from public/: there is no house,
 * clock, or gear asset there, and an <img> cannot inherit currentColor, which
 * is what tints the active tab.
 */

function HomeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3 4v4h4" />
      <path d="M12 7.5V12l3 1.8" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Lobed cog outline. Straight radiating spokes off a circle read as a
          sun rather than a gear, so the teeth are drawn as rounded lobes. */}
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Sits below Modal's z-50 backdrop, so an open modal covers the bar. */
export default function BottomTabBar({
  active,
  onSettingsClick,
}: {
  active: "home" | "history";
  onSettingsClick: () => void;
}) {
  const cell = (isActive: boolean) =>
    `flex flex-col items-center justify-center gap-1 min-h-14 px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] transition ${
      isActive ? "text-slate-900" : "text-slate-500"
    }`;

  // Rendered for every cell, invisible when inactive, so the three stay aligned.
  const indicator = (isActive: boolean) => (
    <span className={`h-1 w-6 rounded-full ${isActive ? "bg-slate-900" : ""}`} />
  );

  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-0 inset-x-0 z-40 md:hidden border-t border-slate-200 bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
    >
      <div className="grid grid-cols-3">
        <Link
          href="/"
          aria-current={active === "home" ? "page" : undefined}
          className={cell(active === "home")}
        >
          {indicator(active === "home")}
          <HomeIcon />
          Home
        </Link>

        <Link
          href="/history"
          aria-current={active === "history" ? "page" : undefined}
          className={cell(active === "history")}
        >
          {indicator(active === "history")}
          <HistoryIcon />
          History
        </Link>

        <button type="button" onClick={onSettingsClick} aria-haspopup="dialog" className={cell(false)}>
          {indicator(false)}
          <SettingsIcon />
          Settings
        </button>
      </div>
    </nav>
  );
}
