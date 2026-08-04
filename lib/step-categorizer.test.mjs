import assert from "node:assert/strict";
import test from "node:test";

const { classifyShellCommand } = await import("./step-categorizer.ts");

function info(raw) {
  return classifyShellCommand(raw);
}

// ---------------------------------------------------------------------------
// The reported bug: option VALUES must not be mistaken for the target argument
// ---------------------------------------------------------------------------

test("curl: --max-time 60 is an option value, not the fetch target", () => {
  const r = info("curl --max-time 60 https://example.com/data");
  assert.equal(r.kind, "fetch");
  assert.equal(r.binary, "curl");
  assert.equal(r.argument, "https://example.com/data");
});

test("curl: mixed short/long value options are all consumed", () => {
  const r = info('curl -sSL -A "Mozilla/5.0" --max-time 60 -o /dev/null https://example.com');
  assert.equal(r.kind, "fetch");
  assert.equal(r.argument, "https://example.com");
});

test("curl: short cluster with value-taking last option (-sLm 60)", () => {
  const r = info("curl -sLm 60 https://example.com");
  assert.equal(r.argument, "https://example.com");
});

test("curl: attached short value (-m60) is self-contained", () => {
  const r = info("curl -m60 https://example.com");
  assert.equal(r.argument, "https://example.com");
});

test("curl: --max-time=60 (equals form) is self-contained", () => {
  const r = info("curl --max-time=60 https://example.com");
  assert.equal(r.argument, "https://example.com");
});

test("curl: -d payload and -H header values are consumed before the URL", () => {
  const r = info("curl -X POST -d '{\"a\":1}' -H 'Content-Type: application/json' https://api.example.com");
  assert.equal(r.kind, "fetch");
  assert.equal(r.argument, "https://api.example.com");
});

test("curl: with no URL at all, the argument is undefined", () => {
  const r = info("curl --max-time 60");
  assert.equal(r.kind, "fetch");
  assert.equal(r.argument, undefined);
});

test("wget: -O output file is consumed as the option value", () => {
  const r = info("wget -q -O out.html --timeout 30 https://example.com");
  assert.equal(r.kind, "fetch");
  assert.equal(r.argument, "https://example.com");
});

test("wget: -O - (stdout) is consumed, URL survives", () => {
  const r = info("wget -O - https://example.com");
  assert.equal(r.argument, "https://example.com");
});

// ---------------------------------------------------------------------------
// Wrapper commands (timeout, sudo, bash -c, env …)
// ---------------------------------------------------------------------------

test("timeout: duration and flags are skipped before the real command", () => {
  const r = info("timeout 60 curl --max-time 30 https://example.com");
  assert.equal(r.kind, "fetch");
  assert.equal(r.binary, "curl");
  assert.equal(r.argument, "https://example.com");
});

test("timeout: value-taking wrapper flag (-s KILL) is consumed", () => {
  const r = info("timeout --signal KILL 10 curl https://example.com");
  assert.equal(r.binary, "curl");
  assert.equal(r.argument, "https://example.com");
});

test("sudo: -u user is consumed, real command is classified", () => {
  const r = info("sudo -u root curl https://example.com");
  assert.equal(r.binary, "curl");
  assert.equal(r.argument, "https://example.com");
});

test("env: VAR=value assignments are skipped", () => {
  const r = info("env FOO=bar curl https://example.com");
  assert.equal(r.binary, "curl");
  assert.equal(r.argument, "https://example.com");
});

test("env -i: flags and assignments are skipped", () => {
  const r = info("env -i PATH=/usr/bin HOME=/root curl https://example.com");
  assert.equal(r.binary, "curl");
  assert.equal(r.argument, "https://example.com");
});

test("bash -c: the inner command is unwrapped and re-parsed", () => {
  const r = info('bash -c "curl --max-time 60 https://x.io"');
  assert.equal(r.kind, "fetch");
  assert.equal(r.binary, "curl");
  assert.equal(r.argument, "https://x.io");
});

test("eval: the quoted command string is re-parsed", () => {
  const r = info('eval "ls -la src"');
  assert.equal(r.kind, "list");
  assert.equal(r.binary, "ls");
  assert.equal(r.argument, "src");
});

// ---------------------------------------------------------------------------
// Other command families with value-taking options
// ---------------------------------------------------------------------------

test("find: -maxdepth 2 is an option value, path operand wins", () => {
  const r = info('find . -maxdepth 2 -name "*.ts"');
  assert.equal(r.kind, "find");
  assert.equal(r.argument, ".");
});

test("grep: -m max count is consumed, pattern survives", () => {
  const r = info("grep -rn -m 5 foobar .");
  assert.equal(r.kind, "search");
  assert.equal(r.argument, "foobar");
});

test("rg: -g glob and -t type are consumed, pattern survives", () => {
  const r = info('rg -l --type ts -g "*.spec.ts" pattern src/');
  assert.equal(r.kind, "search");
  assert.equal(r.argument, "pattern");
});

test("tail: -n count is consumed, file survives", () => {
  const r = info("tail -n 50 app.log");
  assert.equal(r.kind, "read");
  assert.equal(r.argument, "app.log");
});

// ---------------------------------------------------------------------------
// Boolean switches must NOT consume the next token
// ---------------------------------------------------------------------------

test("ls: no value flags, directory survives", () => {
  const r = info("ls -la src");
  assert.equal(r.kind, "list");
  assert.equal(r.argument, "src");
});

test("rm: -rf is boolean, target survives", () => {
  const r = info("rm -rf dist");
  assert.equal(r.kind, "delete");
  assert.equal(r.argument, "dist");
});

test("curl: -sSL boolean cluster does not consume the URL", () => {
  const r = info("curl -sSL https://example.com");
  assert.equal(r.argument, "https://example.com");
});

test("grep: -rn is boolean, pattern survives", () => {
  const r = info("grep -rn foobar .");
  assert.equal(r.argument, "foobar");
});

// ---------------------------------------------------------------------------
// First meaningful positional still wins (subcommands, scripts)
// ---------------------------------------------------------------------------

test("git commit: subcommand is the first positional", () => {
  const r = info('git commit -m "fix bug"');
  assert.equal(r.kind, "run");
  assert.equal(r.binary, "git");
  assert.equal(r.argument, "commit");
});

test("npm run: subcommand is the first positional", () => {
  const r = info("npm run build");
  assert.equal(r.binary, "npm");
  assert.equal(r.argument, "run");
});

test("node: -e code is consumed, script file survives", () => {
  const r = info("node -e 'console.log(1)' app.js");
  assert.equal(r.binary, "node");
  assert.equal(r.argument, "app.js");
});

test("docker run: subcommand is the first positional", () => {
  const r = info("docker run -d --name web -p 8080:80 nginx");
  assert.equal(r.kind, "run");
  assert.equal(r.argument, "run");
});

test("piped chain: first segment wins", () => {
  const r = info("cat file.txt | grep foo");
  assert.equal(r.kind, "read");
  assert.equal(r.binary, "cat");
  assert.equal(r.argument, "file.txt");
});

test("end-of-options marker: next token becomes positional", () => {
  const r = info("rm -- -weird-name.txt");
  assert.equal(r.kind, "delete");
  assert.equal(r.argument, "-weird-name.txt");
});
