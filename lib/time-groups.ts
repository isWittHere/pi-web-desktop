import type { TimeBucket } from "./types";

/**
 * Time-group buckets for the session list, newest first. `pinned` is assigned
 * by the UI from the persisted pin flag; the remaining buckets are computed
 * from the session's `modified` timestamp.
 */
export const TIME_BUCKET_ORDER: readonly TimeBucket[] = [
  "pinned",
  "today",
  "yesterday",
  "week",
  "month",
  "earlier",
];

/**
 * Bucket a `modified` timestamp (ISO string) into a time group using the
 * *local* calendar day, so "today" means the same day as the viewer's clock.
 *
 * Boundaries are calendar-day based, not rolling 24h windows:
 *   today     — same calendar day as now (future-dated sessions also land
 *               here, tolerating clock skew and timezone differences)
 *   yesterday — the previous calendar day
 *   week      — 2..7 calendar days ago
 *   month     — 8..30 calendar days ago
 *   earlier   — anything older, or an unparseable timestamp
 */
export function bucketOf(modified: string, now: Date = new Date()): TimeBucket {
  const date = new Date(modified);
  if (Number.isNaN(date.getTime())) return "earlier";
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  // Both values are UTC milliseconds of *local* midnight, so rounding (not
  // flooring) absorbs DST transitions where a calendar day is 23/25h long.
  const diffDays = Math.round((startOfToday - startOfDay) / 86400000);
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays <= 7) return "week";
  if (diffDays <= 30) return "month";
  return "earlier";
}

/** Bucket label i18n key (en/zh parity enforced by the catalog test). */
export function timeBucketKey(bucket: TimeBucket): string {
  switch (bucket) {
    case "pinned": return "desktop.groupPinned";
    case "today": return "desktop.groupToday";
    case "yesterday": return "desktop.groupYesterday";
    case "week": return "desktop.groupWeek";
    case "month": return "desktop.groupMonth";
    case "earlier": return "desktop.groupEarlier";
  }
}
