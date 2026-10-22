import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

export const formatINR = (v, { compact = false } = {}) => {
  const n = Number(v || 0);
  if (compact && Math.abs(n) >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (compact && Math.abs(n) >= 1000) return `₹${(n / 1000).toFixed(1)}k`;
  return compact ? inr0.format(n) : inr.format(n);
};
export const formatNumber = (v) => num.format(Number(v || 0));

export const formatDate = (v, opts = {}) => {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v.length === 10 ? `${v}T00:00:00` : v) : v;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", ...opts });
};
export const formatDateTime = (v) => {
  if (!v) return "—";
  return new Date(v).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
  });
};
export const formatTime = (v) =>
  v ? new Date(v).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }) : "—";

export const todayISO = () => {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};
export const daysAgoISO = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};

export const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

/** Last `n` calendar months, oldest first: [{ key: "2026-10", label: "Oct 26" }, ...]. */
export const lastMonths = (n) => {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1);
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
    };
  });
};

/** Sum `value(row)` into the month of `dateOf(row)` (ISO date or datetime string). */
export const sumByMonth = (rows, months, dateOf, value) => {
  const totals = Object.fromEntries(months.map((m) => [m.key, 0]));
  for (const r of rows) {
    const d = dateOf(r);
    if (!d) continue;
    const key = d.slice(0, 7);
    if (key in totals) totals[key] += Number(value(r)) || 0;
  }
  return months.map((m) => round2(totals[m.key]));
};
