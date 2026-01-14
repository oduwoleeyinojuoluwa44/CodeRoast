const assert = require("node:assert/strict");
const { test } = require("node:test");
const { runEvidenceGuardAgent } = require("../dist/agents/evidence-guard-agent.js");

test("marks issues without evidence as incomplete", () => {
  const guarded = runEvidenceGuardAgent({
    issues: [
      {
        type: "testing",
        signal: "testPresence",
        confidence: "medium",
        evidence: [],
      },
    ],
  });

  assert.equal(guarded.issues.length, 1);
  assert.equal(guarded.issues[0].evidenceComplete, false);
  assert.ok(guarded.issues[0].missingEvidenceReason);
});

test("passes issues with valid evidence", () => {
  const guarded = runEvidenceGuardAgent({
    issues: [
      {
        type: "duplication",
        signal: "duplicateBlocks",
        confidence: "high",
        evidence: [
          {
            file: "src/dup.ts",
            startLine: 10,
            endLine: 20,
            metrics: [
              { type: "loc", value: 11 },
              { type: "count", value: 2 },
              { type: "hash", value: "abc123" },
            ],
          },
        ],
      },
    ],
  });

  assert.equal(guarded.issues.length, 1);
  assert.equal(guarded.issues[0].evidenceComplete, true);
  assert.equal(guarded.issues[0].missingEvidenceReason, undefined);
});
