import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./stream-update-scheduler.ts");
}

function createClock() {
  let time = 0;
  let nextHandle = 1;
  const frames = new Map();
  const timers = new Map();

  return {
    platform: {
      now: () => time,
      requestFrame(callback) {
        const handle = nextHandle++;
        frames.set(handle, callback);
        return handle;
      },
      cancelFrame(handle) {
        frames.delete(handle);
      },
      setTimer(callback, delay) {
        const handle = nextHandle++;
        timers.set(handle, { callback, delay });
        return handle;
      },
      clearTimer(handle) {
        timers.delete(handle);
      },
    },
    setTime(next) {
      time = next;
    },
    runFrame() {
      const [handle, callback] = frames.entries().next().value ?? [];
      assert.ok(handle, "expected one queued animation frame");
      frames.delete(handle);
      callback(time);
    },
    runTimer() {
      const [handle, timer] = timers.entries().next().value ?? [];
      assert.ok(handle, "expected one queued timer");
      timers.delete(handle);
      timer.callback();
      return timer.delay;
    },
    get queuedFrames() {
      return frames.size;
    },
    get queuedTimers() {
      return timers.size;
    },
  };
}

test("coalesces burst updates to the newest complete snapshot", async () => {
  const { createStreamUpdateScheduler } = await loadSubject();
  const clock = createClock();
  const committed = [];
  const scheduler = createStreamUpdateScheduler((value) => committed.push(value), {
    ...clock.platform,
    maxUpdatesPerSecond: 30,
  });

  scheduler.enqueue("first");
  scheduler.enqueue("second");
  scheduler.enqueue("latest");
  assert.equal(clock.queuedFrames, 1);

  clock.runFrame();
  await Promise.resolve(); // commit is deferred to a microtask
  assert.deepEqual(committed, ["latest"]);
});

test("caps commits and resumes with the newest value after the frame interval", async () => {
  const { createStreamUpdateScheduler } = await loadSubject();
  const clock = createClock();
  const committed = [];
  const scheduler = createStreamUpdateScheduler((value) => committed.push(value), {
    ...clock.platform,
    maxUpdatesPerSecond: 30,
  });

  scheduler.enqueue("one");
  clock.runFrame();
  await Promise.resolve();
  clock.setTime(10);
  scheduler.enqueue("two");
  scheduler.enqueue("three");
  clock.runFrame();
  await Promise.resolve();

  assert.deepEqual(committed, ["one"]);
  assert.equal(clock.queuedTimers, 1);
  assert.ok(clock.runTimer() > 20);
  clock.setTime(34);
  clock.runFrame();
  await Promise.resolve();
  assert.deepEqual(committed, ["one", "three"]);
});

test("reset cancels delayed updates so stale stream content cannot commit", async () => {
  const { createStreamUpdateScheduler } = await loadSubject();
  const clock = createClock();
  const committed = [];
  const scheduler = createStreamUpdateScheduler((value) => committed.push(value), clock.platform);

  scheduler.enqueue("stale");
  scheduler.reset();
  assert.equal(clock.queuedFrames, 0);
  assert.equal(clock.queuedTimers, 0);
  assert.deepEqual(committed, []);

  scheduler.enqueue("fresh");
  clock.runFrame();
  await Promise.resolve();
  assert.deepEqual(committed, ["fresh"]);
});

test("flush immediately commits the final queued snapshot", async () => {
  const { createStreamUpdateScheduler } = await loadSubject();
  const clock = createClock();
  const committed = [];
  const scheduler = createStreamUpdateScheduler((value) => committed.push(value), clock.platform);

  scheduler.enqueue("partial");
  scheduler.enqueue("final");
  scheduler.flush();

  assert.deepEqual(committed, ["final"]);
  assert.equal(clock.queuedFrames, 0);
});
