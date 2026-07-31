import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import jitiFactory from "jiti";

const jiti = jitiFactory(import.meta.url, { interopDefault: true });
const { readUtf8FileWithinLimit, resolveBashOutputPath } = jiti("./bash-output.ts");

test("only accepts SDK-shaped bash logs directly under the temp directory", () => {
  const root = tmpdir();
  assert.equal(resolveBashOutputPath(join(root, "pi-bash-safe_123.log"), root), join(root, "pi-bash-safe_123.log"));
  assert.equal(resolveBashOutputPath(join(root, "other.log"), root), null);
  assert.equal(resolveBashOutputPath(join(root, "nested", "pi-bash-safe.log"), root), null);
});

test("reads bounded UTF-8 output and refuses oversized output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-bash-output-test-"));
  const file = join(dir, "output.log");
  try {
    await writeFile(file, "hello", "utf8");
    assert.deepEqual(await readUtf8FileWithinLimit(file, 10), { tooLarge: false, content: "hello", size: 5 });
    assert.deepEqual(await readUtf8FileWithinLimit(file, 4), { tooLarge: true, size: 5 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
