const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { runRepoScannerAgent } = require("../dist/agents/repo-scanner-agent.js");
const { runCodeAnalysisAgent } = require("../dist/agents/code-analysis-agent.js");

async function withTempDir(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "coderoast-"));
  try {
    await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeFile(filePath, contents = "") {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents);
}

function createConfig(root) {
  return {
    path: root,
    severity: "gentle",
    focus: "general",
  };
}

test("analyzes ts/js files for core signals", async () => {
  await withTempDir(async (root) => {
    const duplicateBlock = Array.from({ length: 10 }, (_, i) => `const dup${i} = ${i};`).join("\n");
    const longLines = Array.from({ length: 55 }, (_, i) => `  const line${i} = ${i};`).join("\n");

    await writeFile(
      path.join(root, "src/dup-a.ts"),
      `export function alpha() {\n${duplicateBlock}\n}\n`
    );
    await writeFile(
      path.join(root, "src/dup-b.ts"),
      `export function beta() {\n${duplicateBlock}\n}\n`
    );
    await writeFile(
      path.join(root, "src/long.ts"),
      `export function longFn() {\n${longLines}\n}\n`
    );
    await writeFile(
      path.join(root, "src/a.ts"),
      `import { valueB } from "./b";\nexport const valueA = valueB;\n`
    );
    await writeFile(
      path.join(root, "src/b.ts"),
      `import { valueA } from "./a";\nexport const valueB = valueA;\n`
    );
    await writeFile(path.join(root, "src/__tests__/smoke.test.ts"), "test('smoke', () => {});");

    const config = createConfig(root);
    const scan = await runRepoScannerAgent(config);
    const analysis = await runCodeAnalysisAgent(config, scan);

    assert.ok(analysis.signals.longFunctions.length >= 1);
    const longFn = analysis.signals.longFunctions.find(
      (fn) => fn.file === "src/long.ts"
    );
    assert.ok(longFn);
    assert.equal(typeof longFn.startLine, "number");
    assert.equal(typeof longFn.endLine, "number");
    assert.ok(longFn.endLine >= longFn.startLine);

    assert.ok(analysis.signals.duplicateBlocks.length >= 1);
    assert.ok(
      analysis.signals.duplicateBlocks.some((block) =>
        block.occurrences.some((occurrence) => occurrence.file === "src/dup-a.ts")
      )
    );

    const cycle = analysis.signals.circularDependencies.find(
      (item) =>
        (item.from === "src/a.ts" && item.to === "src/b.ts") ||
        (item.from === "src/b.ts" && item.to === "src/a.ts")
    );
    assert.ok(cycle);
    assert.equal(typeof cycle.fromStartLine, "number");
    assert.equal(typeof cycle.fromEndLine, "number");
    assert.equal(typeof cycle.toStartLine, "number");
    assert.equal(typeof cycle.toEndLine, "number");
    assert.ok(cycle.fromEndLine >= cycle.fromStartLine);
    assert.ok(cycle.toEndLine >= cycle.toStartLine);

    assert.equal(analysis.signals.testPresence.hasTests, true);
    assert.ok(analysis.signals.testPresence.testFiles.includes("src/__tests__/smoke.test.ts"));
  });
});
