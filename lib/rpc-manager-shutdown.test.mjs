import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

function createInner(calls, { failShutdown = false } = {}) {
  return {
    isBashRunning: false,
    extensionRunner: {
      async emit(event) {
        calls.push(["emit", event]);
        if (failShutdown) throw new Error("shutdown hook failed");
      },
    },
    dispose() {
      calls.push(["dispose"]);
    },
  };
}

test("session shutdown notifies extensions before disposing once", async () => {
  const calls = [];
  const wrapper = new AgentSessionWrapper(createInner(calls));
  wrapper.onDestroy(() => calls.push(["destroy"]));

  await Promise.all([wrapper.shutdown(), wrapper.shutdown()]);

  assert.deepEqual(calls, [
    ["emit", { type: "session_shutdown", reason: "quit" }],
    ["dispose"],
    ["destroy"],
  ]);
  assert.equal(wrapper.isAlive(), false);
});

test("shutdown disposes the SDK session when an extension hook fails", async () => {
  const calls = [];
  const wrapper = new AgentSessionWrapper(createInner(calls, { failShutdown: true }));
  wrapper.onDestroy(() => calls.push(["destroy"]));

  await assert.rejects(wrapper.shutdown(), /shutdown hook failed/);
  assert.deepEqual(calls.map(([name]) => name), ["emit", "dispose", "destroy"]);
  assert.equal(wrapper.isAlive(), false);
});
