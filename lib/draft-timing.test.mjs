// Models the ChatInput draft persistence timing that caused content loss when
// switching sessions, and verifies the fix.
//
// Why content was lost: ChatWindow remounts on every session switch
// (key={sessionKey}), and the committed 445d483 change restored drafts in a
// post-mount effect while the save effect ran FIRST with the empty initial
// value. Because setDraft() deletes empty drafts, the persisted draft was
// destroyed before the restore effect could read it. The working-tree guard
// (draftRestoredRef) fixed the plain mount case but NOT React StrictMode
// (dev-only, enabled by default in Next App Router): StrictMode re-runs mount
// effects with the SAME commit snapshot, so the second save-effect run still
// deleted the draft after the restore effect had marked the key restored.
//
// The fix: restore drafts synchronously via the useState lazy initializer
// (like upstream pi-web) and make the save effect skip while the editor still
// holds the restored snapshot. Both are StrictMode-safe.
//
// The model mirrors React semantics: effects run against a commit snapshot of
// state; setState calls queue pending updates applied after the effect pass;
// StrictMode mount = two effect passes sharing the same snapshot.
import assert from "node:assert/strict";

// ---- draft-store simulation (mirrors lib/draft-store.ts) ----
const storage = new Map();
const drafts = new Map();

function persist() {
  storage.set("pi-drafts", JSON.stringify([...drafts].map(([key, draft]) => ({ key, draft }))));
}
function loadFromStorage() {
  const raw = storage.get("pi-drafts");
  if (!raw) return;
  for (const entry of JSON.parse(raw)) drafts.set(entry.key, entry.draft);
}
function setDraft(key, draft) {
  if (!draft.value && draft.images.length === 0) drafts.delete(key);
  else drafts.set(key, { value: draft.value, images: [...draft.images] });
  persist();
}
function getDraft(key) {
  const d = drafts.get(key);
  return d ? { value: d.value, images: [...d.images] } : null;
}
function clearDraft(key) {
  drafts.delete(key);
  persist();
}

// ---- ChatInput simulation (final fixed logic) ----
// Mirrors: lazy useState initializer reading the store, draftRestoredRef,
// restoredSnapshotRef, save effect, restore effect, clearInput.
function createInput(initialDraftKey) {
  // useState lazy initializer (client side — the window guard is trivially true)
  let value = initialDraftKey ? getDraft(initialDraftKey)?.value ?? "" : "";
  let images = initialDraftKey ? [...(getDraft(initialDraftKey)?.images ?? [])] : [];
  let draftKey = initialDraftKey;
  let draftKeyRef = draftKey;
  let draftRestoredRef = null;
  let restoredSnapshotRef = null;
  let pendingValue = null;
  let pendingImages = null;

  function runEffects(snapshot) {
    // Save effect (declared before the restore effect, as in ChatInput).
    if (draftKey && draftRestoredRef === draftKey) {
      const snap = restoredSnapshotRef;
      const imagesInCommit = snapshot.images;
      if (!(snap && snap.value === snapshot.value && snap.imageCount === imagesInCommit.length)) {
        restoredSnapshotRef = null;
        setDraft(draftKey, { value: snapshot.value, images: imagesInCommit });
      }
    }
    // Restore effect: on mount the lazy initializer already restored the
    // editor, so only key changes reload the editor state.
    const previousDraftKey = draftKeyRef;
    const keyChanged = previousDraftKey !== draftKey;
    if (previousDraftKey && keyChanged && draftRestoredRef === previousDraftKey) {
      setDraft(previousDraftKey, { value: snapshot.value, images: snapshot.images });
    }
    const draft = draftKey ? getDraft(draftKey) : null;
    if (keyChanged) {
      pendingValue = draft?.value ?? "";
      pendingImages = draft ? [...draft.images] : [];
    }
    draftKeyRef = draftKey;
    draftRestoredRef = draftKey ?? null;
    restoredSnapshotRef = draft
      ? { value: draft.value, imageCount: draft.images.length }
      : { value: "", imageCount: 0 };
  }

  function applyPending() {
    if (pendingValue !== null) { value = pendingValue; pendingValue = null; }
    if (pendingImages !== null) { images = pendingImages; pendingImages = null; }
  }

  /** One effect pass against a commit snapshot, then apply queued state. */
  function commitEffects(strict = false) {
    const snapshot = { value, images: [...images] };
    runEffects(snapshot);
    applyPending();
    if (strict) {
      // React StrictMode mount: effects are cleaned up and re-run with the
      // SAME commit snapshot (state updates flush after the whole phase).
      runEffects(snapshot);
      applyPending();
    }
  }

  return {
    // Mount: initial state came from the lazy initializer already; run the
    // mount effects (double-invoked under StrictMode).
    mount(strict = false) { commitEffects(strict); },
    // User typed — onChange → re-render → effects (single run, deps changed).
    type(text) {
      value += text;
      commitEffects(false);
    },
    // User deleted all text — same path, but now the draft must be deleted.
    clearAll() {
      value = "";
      images = [];
      commitEffects(false);
    },
    // draftKey prop changed without a remount (e.g. promotion edge) — update
    // effect, single run.
    setKey(key) {
      draftKey = key;
      commitEffects(false);
    },
    // clearInput() after sending.
    clear() {
      value = "";
      images = [];
      if (draftKey) clearDraft(draftKey);
      if (draftKeyRef && draftKeyRef !== draftKey) clearDraft(draftKeyRef);
    },
    get value() { return value; },
    get draftKey() { return draftKey; },
  };
}

// ---- Scenario 1: type in a draft, switch away, switch back ----
loadFromStorage();
const draftId = "draft-A";
const realSessionId = "real-S";

const input = createInput(draftId);
input.mount(); // fresh draft mount, no stored content
assert.equal(input.value, "", "fresh draft opens empty");
input.type("Hello world");
assert.equal(getDraft(draftId)?.value, "Hello world", "draft text persisted while typing");

const input2 = createInput(realSessionId);
input2.mount();
assert.equal(input2.value, "", "real session opens empty");
assert.equal(getDraft(draftId)?.value, "Hello world", "draft A still persisted after switching away");

const input3 = createInput(draftId);
input3.mount();
assert.equal(input3.value, "Hello world", "draft text restored after switching back (synchronous initializer)");
assert.equal(getDraft(draftId)?.value, "Hello world", "restored draft still in storage");

// ---- Scenario 2: StrictMode mount double-invoke must not delete drafts ----
// The exact case that still lost content after the draftRestoredRef-only patch.
loadFromStorage();
const draftB = "draft-B";
setDraft(draftB, { value: "persisted text", images: [] }); // session B already has a draft

const inputB = createInput(draftB);
inputB.mount(true); // StrictMode: effects run twice with the same snapshot
assert.equal(inputB.value, "persisted text", "StrictMode mount restores the persisted text");
assert.equal(getDraft(draftB)?.value, "persisted text", "StrictMode mount does NOT delete the draft");

// Same for a real session id (the user's exact complaint: typed content in a
// real session vanishes after switching sessions).
const realB = "real-B";
setDraft(realB, { value: "typed but unsent", images: [] });
const inputReal = createInput(realB);
inputReal.mount(true);
assert.equal(inputReal.value, "typed but unsent", "real-session draft restored under StrictMode");
assert.equal(getDraft(realB)?.value, "typed but unsent", "real-session draft kept under StrictMode");

// ---- Scenario 3: switching between two real sessions, both with drafts ----
const realC = "real-C";
setDraft(realC, { value: "session C draft", images: [] });
const c = createInput(realC);
c.mount();
assert.equal(c.value, "session C draft", "session C draft restored on switch");
c.type(" more");

const b2 = createInput(realB);
b2.mount();
assert.equal(b2.value, "typed but unsent", "session B draft restored after leaving C");
assert.equal(getDraft(realC)?.value, "session C draft more", "session C kept its updated draft");
b2.type(" and more");
assert.equal(getDraft(realB)?.value, "typed but unsent and more", "session B draft updated while typing");

// ---- Scenario 4: promotion — send clears the draft, real session opens empty ----
const draftD = "draft-D";
setDraft(draftD, { value: "first message", images: [] });
const promoted = createInput(draftD);
promoted.mount();
promoted.clear(); // clearInput() on send
const promotedReal = createInput("real-D");
promotedReal.mount();
assert.equal(promotedReal.value, "", "promoted session opens empty");
assert.equal(getDraft(draftD), null, "promoted draft cleaned up on send");

// ---- Scenario 5: user deliberately clears all text → draft deleted ----
const draftE = "draft-E";
setDraft(draftE, { value: "to be deleted", images: [] });
const e = createInput(draftE);
e.mount();
e.clearAll();
assert.equal(getDraft(draftE), null, "clearing all text deletes the draft (intended)");

// ---- Scenario 6: draftKey changes on the same mounted instance ----
const draftF = "draft-F";
setDraft(draftF, { value: "old key content", images: [] });
const f = createInput(draftF);
f.mount();
f.type(" updated");
f.setKey("new-key");
assert.equal(getDraft(draftF)?.value, "old key content updated", "outgoing key saved before switching");
assert.equal(getDraft("new-key"), null, "new key has no draft yet");
f.type(" more");
assert.equal(getDraft("new-key")?.value, " more", "new key draft saved while typing");

// ---- Regression guard: the committed (broken) logic must fail this test ----
// Model 445d483: useState("") + restore effect guarded only by draftKeyRef.
function createBrokenInput(initialDraftKey) {
  let value = ""; // useState("") — no initializer restore
  let images = [];
  let draftKey = initialDraftKey;
  let draftKeyRef = draftKey;
  let pendingValue = null;
  function runEffects(snapshot) {
    if (draftKey && draftKeyRef === draftKey) {
      setDraft(draftKey, { value: snapshot.value, images: snapshot.images });
    }
    const previousDraftKey = draftKeyRef;
    if (previousDraftKey === draftKey) return;
    if (previousDraftKey) {
      setDraft(previousDraftKey, { value: snapshot.value, images: snapshot.images });
    }
    const draft = draftKey ? getDraft(draftKey) : null;
    draftKeyRef = draftKey;
    pendingValue = draft?.value ?? "";
  }
  return {
    mount(strict = false) {
      const snapshot = { value, images: [...images] };
      runEffects(snapshot);
      if (pendingValue !== null) { value = pendingValue; pendingValue = null; }
      if (strict) { runEffects(snapshot); if (pendingValue !== null) { value = pendingValue; pendingValue = null; } }
    },
    get value() { return value; },
  };
}
loadFromStorage();
setDraft("broken-S", { value: "precious text", images: [] });
const broken = createBrokenInput("broken-S");
broken.mount(true); // StrictMode, as in `npm run dev`
assert.notEqual(broken.value, "precious text", "sanity: broken model loses the draft (documents the bug)");
assert.equal(getDraft("broken-S"), null, "sanity: broken model deleted the draft (documents the bug)");

console.log("All draft persistence timing scenarios passed");
