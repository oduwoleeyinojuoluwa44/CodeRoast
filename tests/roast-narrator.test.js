const assert = require("node:assert/strict");
const { test } = require("node:test");
const { runRoastNarratorAgent } = require("../dist/agents/roast-narrator-agent.js");
const {
  setGeminiClientFactoryForTests,
} = require("../dist/agents/gemini-client.js");

function createConfig() {
  return { path: ".", severity: "gentle", focus: "general" };
}

function createInsights() {
  return {
    issues: [
      {
        type: "duplication",
        signal: "duplicateBlocks",
        confidence: "high",
        evidenceComplete: true,
        evidence: [
          {
            file: "src/a.ts",
            startLine: 1,
            endLine: 3,
            metrics: [{ type: "loc", value: 3 }],
          },
        ],
      },
      {
        type: "testing",
        signal: "testPresence",
        confidence: "medium",
        evidenceComplete: false,
        evidence: [],
        missingEvidenceReason: "No evidence items provided.",
      },
    ],
  };
}

test("falls back to deterministic output without Gemini API key", async () => {
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  setGeminiClientFactoryForTests(null);

  const result = await runRoastNarratorAgent(createConfig(), createInsights());
  assert.match(result.content, /Repeated code/i);
  assert.match(result.content, /src\/a\.ts lines 1-3/);
  assert.match(result.content, /not enough data/);

  if (originalKey) {
    process.env.GEMINI_API_KEY = originalKey;
  }
  setGeminiClientFactoryForTests(null);
});

test("uses Gemini output when available", async () => {
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  setGeminiClientFactoryForTests(() => ({
    models: {
      generateContent: async () => ({
        text: '[{"id":1,"text":"Duplication at src/a.ts lines 1-3."},{"id":2,"text":"not enough data"}]',
      }),
    },
  }));

  const result = await runRoastNarratorAgent(createConfig(), createInsights());
  assert.match(result.content, /Duplication at src\/a\.ts lines 1-3\./);
  assert.match(result.content, /not enough data/);

  if (originalKey) {
    process.env.GEMINI_API_KEY = originalKey;
  } else {
    delete process.env.GEMINI_API_KEY;
  }
  setGeminiClientFactoryForTests(null);
});

test("falls back when Gemini output is invalid", async () => {
  const originalKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  setGeminiClientFactoryForTests(() => ({
    models: {
      generateContent: async () => ({ text: "not json" }),
    },
  }));

  const result = await runRoastNarratorAgent(createConfig(), createInsights());
  assert.match(result.content, /Repeated code/i);
  assert.match(result.content, /src\/a\.ts lines 1-3/);
  assert.match(result.content, /not enough data/);

  if (originalKey) {
    process.env.GEMINI_API_KEY = originalKey;
  } else {
    delete process.env.GEMINI_API_KEY;
  }
  setGeminiClientFactoryForTests(null);
});
