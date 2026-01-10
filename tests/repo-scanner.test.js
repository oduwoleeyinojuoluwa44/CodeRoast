const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { runRepoScannerAgent } = require("../dist/agents/repo-scanner-agent.js");

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

test("scans an empty repo", async () => {
  await withTempDir(async (root) => {
    const result = await runRepoScannerAgent(createConfig(root));
    assert.equal(result.totalFiles, 0);
    assert.equal(result.totalFolders, 1);
    assert.deepEqual(result.languages, {});
    assert.deepEqual(result.fileTypes, {});
    assert.deepEqual(result.entryPoints, []);
    assert.deepEqual(result.files, []);
  });
});

test("ignores auto-ignored directories", async () => {
  await withTempDir(async (root) => {
    await writeFile(path.join(root, "src/index.ts"), "console.log('hi');");
    await writeFile(path.join(root, "node_modules/pkg/index.js"), "module.exports = {};");

    const result = await runRepoScannerAgent(createConfig(root));
    assert.equal(result.totalFiles, 1);
    assert.equal(result.languages.ts, 1);
    assert.ok(result.ignoredCount >= 1);
  });
});

test("detects entry points and project files", async () => {
  await withTempDir(async (root) => {
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ main: "lib/index.js", bin: { coderoast: "bin/cli.js" } }, null, 2)
    );
    await writeFile(path.join(root, "lib/index.js"), "");
    await writeFile(path.join(root, "bin/cli.js"), "");
    await writeFile(path.join(root, "src/index.ts"), "");
    await writeFile(path.join(root, "server.ts"), "");
    await writeFile(path.join(root, "tsconfig.json"), "{}");

    const result = await runRepoScannerAgent(createConfig(root));
    assert.deepEqual(result.entryPoints, [
      "bin/cli.js",
      "lib/index.js",
      "server.ts",
      "src/index.ts",
    ]);
    assert.ok(result.projectFiles.includes("package.json"));
    assert.ok(result.projectFiles.includes("tsconfig.json"));
  });
});

test("counts languages, file types, and other", async () => {
  await withTempDir(async (root) => {
    await writeFile(path.join(root, "src/index.ts"), "");
    await writeFile(path.join(root, "src/util.js"), "");
    await writeFile(path.join(root, "config.json"), "{}");
    await writeFile(path.join(root, "notes.foo"), "");
    await writeFile(path.join(root, "LICENSE"), "MIT");

    const result = await runRepoScannerAgent(createConfig(root));
    assert.equal(result.totalFiles, 5);
    assert.equal(result.languages.ts, 1);
    assert.equal(result.languages.js, 1);
    assert.equal(result.languages.json, 1);
    assert.equal(result.languages.other, 2);
    assert.equal(result.fileTypes[".ts"], 1);
    assert.equal(result.fileTypes[".js"], 1);
    assert.equal(result.fileTypes[".json"], 1);
    assert.equal(result.fileTypes[".foo"], 1);
    assert.equal(result.fileTypes["<none>"], 1);
    assert.equal(result.files.length, result.totalFiles);
    assert.ok(result.files.some((file) => file.path === "src/index.ts"));
  });
});
