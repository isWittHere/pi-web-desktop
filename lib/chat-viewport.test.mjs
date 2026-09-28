import test from "node:test";
import assert from "node:assert/strict";

async function loadSubject() {
  return import("./chat-viewport.ts");
}

const baseCtx = {
  atBottom: true,
  userOwnsViewport: false,
  containerPresent: true,
  hasTarget: false,
};

function change(kind, overrides = {}) {
  return { rev: 1, kind, prevScrollTop: 0, prevScrollHeight: 0, ...overrides };
}

test("isAtBottom uses the epsilon boundary", async () => {
  const { isAtBottom, BOTTOM_EPS } = await loadSubject();
  assert.equal(isAtBottom(1000, 700, 300), true); // remaining 0
  assert.equal(isAtBottom(1000, 700 - BOTTOM_EPS, 300), true);
  assert.equal(isAtBottom(1000, 700 - BOTTOM_EPS - 1, 300), false);
});

test("anchorScrollTop keeps the distance below the fold constant", async () => {
  const { anchorScrollTop } = await loadSubject();
  // Was scrolled 1500px away from the bottom of a 2000px list; the list grows
  // to 2500px, so the anchor must land at 1000px.
  assert.equal(anchorScrollTop(change("prepend", { prevScrollTop: 500, prevScrollHeight: 2000 }), 2500), 1000);
});

test("anchorScrollTop clamps to the top", async () => {
  const { anchorScrollTop } = await loadSubject();
  assert.equal(anchorScrollTop(change("prepend", { prevScrollTop: 0, prevScrollHeight: 2000 }), 500), 0);
});

test("initial leaves positioning to openPositioning", async () => {
  const { decideViewportAction } = await loadSubject();
  assert.deepEqual(
    decideViewportAction(change("initial"), baseCtx),
    { kind: "keep" },
  );
});

test("compact pins to the bottom instantly", async () => {
  const { decideViewportAction } = await loadSubject();
  assert.deepEqual(
    decideViewportAction(change("compact"), { ...baseCtx, atBottom: false }),
    { kind: "bottom", behavior: "instant" },
  );
});

test("compact still pins when the container is unmounted", async () => {
  const { decideViewportAction } = await loadSubject();
  assert.deepEqual(
    decideViewportAction(change("compact"), { ...baseCtx, containerPresent: false }),
    { kind: "bottom", behavior: "instant" },
  );
});

test("prepend anchors to the measured post-commit height", async () => {
  const { decideViewportAction } = await loadSubject();
  const action = decideViewportAction(
    change("prepend", { prevScrollTop: 500, prevScrollHeight: 2000 }),
    { ...baseCtx, newScrollHeight: 2500 },
  );
  assert.deepEqual(action, { kind: "anchor", scrollTop: 1000 });
});

test("prepend falls back to the previous height without a measurement", async () => {
  const { decideViewportAction } = await loadSubject();
  const action = decideViewportAction(
    change("prepend", { prevScrollTop: 500, prevScrollHeight: 2000 }),
    baseCtx,
  );
  assert.deepEqual(action, { kind: "anchor", scrollTop: 500 });
});

test("replace with a target jumps to the entry", async () => {
  const { decideViewportAction } = await loadSubject();
  assert.deepEqual(
    decideViewportAction(
      change("replace", { targetEntryId: "e1" }),
      { ...baseCtx, hasTarget: true },
    ),
    { kind: "entry" },
  );
});

test("replace without a target keeps the browser clamp", async () => {
  const { decideViewportAction } = await loadSubject();
  assert.deepEqual(decideViewportAction(change("replace"), baseCtx), { kind: "keep" });
});

test("run-end replace follows the bottom only when the user has not taken over", async () => {
  const { decideViewportAction } = await loadSubject();
  assert.deepEqual(
    decideViewportAction(change("replace", { followBottom: true }), { ...baseCtx, userOwnsViewport: false }),
    { kind: "bottom", behavior: "smooth" },
  );
  assert.deepEqual(
    decideViewportAction(change("replace", { followBottom: true }), { ...baseCtx, userOwnsViewport: true }),
    { kind: "keep" },
  );
});

test("append follows the bottom only when already there", async () => {
  const { decideViewportAction } = await loadSubject();
  assert.deepEqual(
    decideViewportAction(change("append"), { ...baseCtx, atBottom: true }),
    { kind: "bottom", behavior: "instant" },
  );
  assert.deepEqual(
    decideViewportAction(change("append"), { ...baseCtx, atBottom: false }),
    { kind: "keep" },
  );
});

test("sending a user message pins it to the top regardless of position", async () => {
  const { decideViewportAction } = await loadSubject();
  assert.deepEqual(
    decideViewportAction(change("append", { pinUserMessageTop: true }), { ...baseCtx, atBottom: false }),
    { kind: "userTop" },
  );
});

test("an unmounted container keeps every non-compaction change", async () => {
  const { decideViewportAction } = await loadSubject();
  const unmounted = { ...baseCtx, containerPresent: false };
  for (const kind of ["initial", "append", "prepend", "replace"]) {
    assert.deepEqual(decideViewportAction(change(kind, { followBottom: true }), unmounted), { kind: "keep" }, kind);
  }
});
