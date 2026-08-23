"use client";

import Link from "next/link";

/**
 * The Home/History links plus the Settings trigger, shared by both pages now
 * that there is more than one tab. Settings-modal *state* stays on each page
 * (it needs page-specific `accounts`/`onSaved`); this just renders the button
 * that opens it.
 */
export default function TabNav({
  active,
  onSettingsClick,
}: {
  active: "home" | "history";
  onSettingsClick: () => void;
}) {
  const tabClass = (tab: "home" | "history") =>
    `text-sm font-semibold uppercase tracking-[0.35em] pb-1 border-b-2 transition ${
      active === tab
        ? "text-slate-900 border-slate-900"
        : "text-slate-500 border-transparent hover:text-slate-800"
    }`;

  return (
    <div className="flex flex-wrap gap-8 items-center text-slate-700">
      <Link href="/" aria-current={active === "home" ? "page" : undefined} className={tabClass("home")}>
        Home
      </Link>

      <Link
        href="/history"
        aria-current={active === "history" ? "page" : undefined}
        className={tabClass("history")}
      >
        History
      </Link>

      <button
        type="button"
        onClick={onSettingsClick}
        className="text-sm font-semibold uppercase tracking-[0.2em] pb-1 border-b-2 border-transparent text-slate-500 hover:text-slate-900 transition"
      >
        Settings
      </button>
    </div>
  );
}
