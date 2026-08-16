/**
 * Relative-time label ("3m ago", "2h ago", "just now") shared by every
 * surface that shows session/workspace timestamps. Accepts either an ISO
 * string (session records) or epoch milliseconds (lobby detection).
 */
export function formatRelativeTime(
  date: string | number,
  t: (key: string, params?: { [k: string]: string | number }) => string,
): string {
  const ms = typeof date === "number" ? date : Date.parse(date);
  if (Number.isNaN(ms)) return "";
  let diff = Date.now() - ms;
  if (diff < 0) diff = 0;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return t("desktop.justNow");
  if (mins < 60) return t("desktop.minutesAgo", { count: mins });
  if (hours < 24) return t("desktop.hoursAgo", { count: hours });
  if (days < 7) return t("desktop.daysAgo", { count: days });
  return new Date(ms).toLocaleDateString();
}
