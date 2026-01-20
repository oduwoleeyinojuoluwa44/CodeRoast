const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { runRepoScannerAgent } = require("../dist/agents/repo-scanner-agent.js");
const { runCodeAnalysisAgent } = require("../dist/agents/code-analysis-agent.js");
const { runInsightAggregatorAgent } = require("../dist/agents/insight-aggregator-agent.js");
const { runEvidenceGuardAgent } = require("../dist/agents/evidence-guard-agent.js");
const { runFixItAgent } = require("../dist/agents/fix-it-agent.js");

async function withTempDir(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "coderoast-fix-"));
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

test("rejects patches outside evidence ranges", async () => {
  await withTempDir(async (root) => {
    const longLines = Array.from({ length: 55 }, (_, i) => `  const line${i} = ${i};`).join("\n");
    const filePath = path.join(root, "src/long.ts");
    await writeFile(
      filePath,
      `// header\nexport function longFn() {\n${longLines}\n}\n`
    );

    const config = createConfig(root);
    const scan = await runRepoScannerAgent(config);
    const analysis = await runCodeAnalysisAgent(config, scan);
    const insights = runInsightAggregatorAgent(scan, analysis);
    const guarded = runEvidenceGuardAgent(insights);

    const originalKey = process.env.GEMINI_API_KEY;
    const originalFetch = globalThis.fetch;
    process.env.GEMINI_API_KEY = "test-key";
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text:
                    "--- a/src/long.ts\n+++ b/src/long.ts\n@@ -1,1 +1,1 @@\n-// header\n+// changed header\n",
                },
              ],
            },
          },
        ],
      }),
      text: async () => "",
    });

    const result = await runFixItAgent(config, scan, analysis, guarded);
    assert.equal(result.suggestions.length > 0, true);
    assert.equal(result.suggestions[0].verified, false);
    assert.match(result.suggestions[0].verificationMessage, /outside evidence/i);

    if (originalKey) {
      process.env.GEMINI_API_KEY = originalKey;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
    globalThis.fetch = originalFetch;
  });
});
