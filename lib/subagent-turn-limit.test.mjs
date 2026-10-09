import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { subagentFinalText } = await jiti.import("./subagent-extension.ts");
const source = (await readFile(new URL("./subagent-runtime.ts", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const extensionSource = (await readFile(new URL("./subagent-extension.ts", import.meta.url), "utf8")).replace(/\r\n/g, "\n");

test("a turn-limit failure keeps the partial output the child did produce", () => {
  const failed = {
    sessionId: "child",
    status: "failed",
    error: "Subagent reached its turn limit (3) without completing the task.",
    result: "Here is what I found so far.",
  };
  const text = subagentFinalText(failed);
  assert.match(text, /^Subagent child failed: Subagent reached its turn limit \(3\)/);
  assert.match(text, /Partial output:\n\nHere is what I found so far\./);
  // A failure with nothing produced keeps the plain sentence.
  assert.equal(
    subagentFinalText({ sessionId: "child", status: "failed", error: "boom" }),
    "Subagent child failed: boom",
  );
  // Whitespace-only output is not partial output.
  assert.equal(
    subagentFinalText({ sessionId: "child", status: "failed", error: "boom", result: "  \n " }),
    "Subagent child failed: boom",
  );
});

test("resume refuses the new-session options instead of ignoring them", () => {
  // A resumed session keeps its own profile, model, thinking and context.
  assert.match(extensionSource, /const creationOptions = \[/);
  assert.match(extensionSource, /params\.model\?\.trim\(\) && "model",/);
  assert.match(extensionSource, /params\.input_files\?\.length && "input_files",/);
  assert.match(extensionSource, /only apply to new subagents\. Omit them to resume the existing session, or start a new subagent\./);
  // The parameter's own description says so, so the model is less likely to try.
  assert.match(extensionSource, /Existing session ID to continue with its current profile, model, thinking, and context\. Omit new-session options\./);
});

test("the limiter holds at the awaited finishTurn boundary, not on turn_end", () => {
  // turn_end fires after the turn is already over, so counting there lets
  // AgentSession start another run for anything still queued.
  assert.match(source, /const previousFinishTurn = inner\.agent\.finishTurn;/);
  assert.match(source, /inner\.agent\.finishTurn = async \(turn, signal\) => \{/);
  assert.doesNotMatch(source, /event\.type !== "turn_end"/);
  // A finalized tool termination ends the run even when the limit has not been reached.
  assert.match(source, /const terminatingTools = new Set<string>\(\);/);
  assert.match(source, /event\.result\?\.terminate === true/);
  assert.match(source, /const toolsContinue = turn\.toolResults\.some\(\(message\) => !terminatingTools\.has\(message\.toolCallId\)\);/);
  // A provider failure or an abort is passed through untouched.
  assert.match(source, /turn\.message\.stopReason === "error" \|\| turn\.message\.stopReason === "aborted"\) return decision;/);
  // Both the boundary and the steering mode are restored, so a resumed run starts clean.
  assert.match(source, /inner\.agent\.finishTurn = previousFinishTurn;/);
  assert.match(source, /inner\.agent\.steeringMode = previousSteeringMode;/);
});

test("the wrap-up turn takes everything queued, so one-at-a-time mode cannot steal it", () => {
  // A steer queued before the wrap-up turn would otherwise take that turn and
  // leave the instruction for a later one, so the final answer read as a failure.
  assert.match(source, /inner\.agent\.steeringMode = "all";\n\s*await inner\.steer\(TURN_LIMIT_INSTRUCTION\);/);
});

test("hitting the limit clears the queues and lists what was never delivered", () => {
  assert.match(source, /const \{ steering, followUp \} = inner\.clearQueue\(\);/);
  assert.match(source, /undelivered = \[\.\.\.undelivered, \.\.\.steering, \.\.\.followUp\];/);
  assert.match(source, /return \{ action: "end" \};/);
  assert.match(source, /stored\.turnLimitReached = true;/);
  assert.match(source, /These queued messages were not delivered:/);
  // Steering after that is refused rather than starting another turn.
  assert.match(source, /turnLimitReached\) throw new Error\("Subagent reached its turn limit and is stopping; resume it to continue"\)/);
});

test("a stop from the child's own chat is reported as aborted, not failed", () => {
  // pi ends the request with stopReason "aborted" without telling the controller.
  assert.match(source, /if \(entry\.message\.stopReason === "aborted"\) return \{ aborted: true \};/);
  assert.match(source, /const aborted = stored\.abortRequested \|\| stop\?\.aborted === true;/);
  // The resume path reads the same signal as the start path.
  assert.match(source, /const stop = stored\.abortRequested \? undefined : lastAssistantStop\(manager\);/);
  // A thrown error is a failure; a turn-limit stop is not reported twice.
  assert.match(source, /status: aborted \? "aborted" : "failed",/);
  assert.doesNotMatch(source, /maxTurnsReached \? "completed"/);
});

test("a budget failure keeps the last assistant text as a partial result", () => {
  assert.match(source, /const errorMessage = aborted \? undefined : stop\?\.error \?\?\n\s*\(maxTurnsReached && turnLimit \? turnLimitError\(turnLimit, undelivered\) : undefined\);/);
  assert.match(source, /\.\.\.\(text \? \{ result: text \} : \{\}\),/);
});
