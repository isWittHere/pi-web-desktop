import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { bucketOf, TIME_BUCKET_ORDER } = await jiti.import("./time-groups.ts");

/**
 * Build a local-calendar ISO timestamp `days` before (or after, when negative)
 * the reference date. Constructing via local date components keeps the tests
 * independent of the machine's timezone / DST.
 */
function atDayOffset(reference, days, hour = 12) {
  const d = new Date(reference);
  const shifted = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, hour, 0, 0, 0);
  return shifted.toISOString();
}

const now = new Date(2026, 5, 15, 18, 30, 0, 0); // local 2026-06-15

test("bucketOf buckets by local calendar day", () => {
  assert.equal(bucketOf(atDayOffset(now, 0), now), "today");
  assert.equal(bucketOf(atDayOffset(now, -1), now), "yesterday");
  assert.equal(bucketOf(atDayOffset(now, -3), now), "week");
  assert.equal(bucketOf(atDayOffset(now, -15), now), "month");
  assert.equal(bucketOf(atDayOffset(now, -60), now), "earlier");
});

test("bucketOf boundary days are inclusive", () => {
  assert.equal(bucketOf(atDayOffset(now, -7), now), "week");
  assert.equal(bucketOf(atDayOffset(now, -8), now), "month");
  assert.equal(bucketOf(atDayOffset(now, -30), now), "month");
  assert.equal(bucketOf(atDayOffset(now, -31), now), "earlier");
});

test("bucketOf ignores the time-of-day portion (a session at 23:59 yesterday still buckets as yesterday)", () => {
  assert.equal(bucketOf(atDayOffset(now, -1, 23), now), "yesterday");
  assert.equal(bucketOf(atDayOffset(now, 0, 0), now), "today");
});

test("bucketOf tolerates future timestamps and unparseable input", () => {
  assert.equal(bucketOf(atDayOffset(now, 1), now), "today");
  assert.equal(bucketOf("not-a-date", now), "earlier");
  assert.equal(bucketOf("", now), "earlier");
});

test("TIME_BUCKET_ORDER is pinned-first, oldest last", () => {
  assert.deepEqual([...TIME_BUCKET_ORDER], ["pinned", "today", "yesterday", "week", "month", "earlier"]);
});
