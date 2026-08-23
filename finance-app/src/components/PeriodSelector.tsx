"use client";

/** How many past years the year dropdown offers, beyond just the current one. */
const YEARS_OF_HISTORY = 10;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export interface PeriodValue {
  mode: "month" | "year";
  month: number;
  year: number;
}

export interface PeriodSelectorProps {
  value: PeriodValue;
  onChange: (next: PeriodValue) => void;
  /** Today, in the app's timezone — bounds the pickers to strictly past periods. */
  today: { year: number; month: number; day: number };
}

/**
 * Lets the History tab browse any past month or past year. Fully controlled —
 * no internal fetch, matching how page.tsx already lifts filter state to the
 * page rather than owning it in the control itself.
 */
export default function PeriodSelector({ value, onChange, today }: PeriodSelectorProps) {
  // Year mode excludes the current year outright (it's still in progress), but
  // month mode should still offer it whenever it has at least one elapsed
  // month — January itself doesn't count, so a January "today" excludes it too.
  const pastYears = Array.from({ length: YEARS_OF_HISTORY }, (_, i) => today.year - 1 - i);
  const monthModeYears = today.month > 1 ? [today.year, ...pastYears] : pastYears;
  const yearModeYears = pastYears;

  const monthsFor = (year: number) => {
    if (year < today.year) return Array.from({ length: 12 }, (_, i) => i + 1);
    return Array.from({ length: today.month - 1 }, (_, i) => i + 1);
  };

  const setMode = (mode: "month" | "year") => {
    if (mode === value.mode) return;
    if (mode === "month") {
      // Every year offered while in year mode is also valid in month mode
      // (monthModeYears is a superset of yearModeYears), so the year carries
      // over unchanged; only the month may need to fall back.
      const options = monthsFor(value.year);
      const month = options.includes(value.month) ? value.month : options[options.length - 1];
      onChange({ mode, month, year: value.year });
    } else {
      // The current year isn't valid in year mode — fall back to last year.
      const year = value.year === today.year ? today.year - 1 : value.year;
      onChange({ mode, month: value.month, year });
    }
  };

  const setYear = (year: number) => {
    if (value.mode === "year") {
      onChange({ ...value, year });
      return;
    }
    const options = monthsFor(year);
    const month = options.includes(value.month) ? value.month : options[options.length - 1];
    onChange({ ...value, year, month });
  };

  const setMonth = (month: number) => {
    onChange({ ...value, month });
  };

  const pill = (active: boolean) =>
    `rounded-full px-4 py-2 text-sm font-semibold transition ${
      active
        ? "bg-slate-900 text-white"
        : "border border-slate-300 bg-white text-slate-700 hover:border-slate-400"
    }`;

  const select =
    "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm focus:border-slate-500 focus:outline-none";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex gap-2">
        <button type="button" className={pill(value.mode === "month")} onClick={() => setMode("month")}>
          Month
        </button>
        <button type="button" className={pill(value.mode === "year")} onClick={() => setMode("year")}>
          Year
        </button>
      </div>

      {value.mode === "month" && (
        <select
          aria-label="Month"
          className={select}
          value={value.month}
          onChange={(event) => setMonth(Number(event.target.value))}
        >
          {monthsFor(value.year).map((month) => (
            <option key={month} value={month}>
              {MONTH_NAMES[month - 1]}
            </option>
          ))}
        </select>
      )}

      <select
        aria-label="Year"
        className={select}
        value={value.year}
        onChange={(event) => setYear(Number(event.target.value))}
      >
        {(value.mode === "month" ? monthModeYears : yearModeYears).map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
    </div>
  );
}
