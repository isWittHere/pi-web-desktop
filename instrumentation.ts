export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();

  // In production Next 16 answers SIGINT/SIGTERM with server.close() and waits
  // for every connection to end, without a timeout. SSE streams only end when
  // the client disconnects, so close them here or the process never exits.
  const { closeAllAgentEventStreams } = await import("@/lib/agent-event-stream");
  const shutdownStreams = () => closeAllAgentEventStreams();

  // This file is compiled once per runtime. Because the project has a proxy
  // (middleware), Next also builds an "instrumentation-edge" entry that it
  // folds into the middleware/edge compiler, where the guard above is folded
  // to a constant. That pass is a syntax-level check, so a literal
  // `process.on(...)` is reported as "A Node.js API is used ... not supported
  // in the Edge Runtime" even though the statement is unreachable there — two
  // warnings on every dev recompile, burying real warnings. Reaching the
  // registrar through `globalThis` keeps the Node.js behavior while leaving no
  // `process.<member>` expression for the edge analyzer to flag.
  const nodeProcess = (globalThis as unknown as {
    process: { on(event: "SIGINT" | "SIGTERM", listener: () => void): unknown };
  }).process;
  nodeProcess.on("SIGINT", shutdownStreams);
  nodeProcess.on("SIGTERM", shutdownStreams);
}
