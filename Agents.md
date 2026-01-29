# Agents Architecture - CodeRoast

This document describes the **agent-based architecture** used in CodeRoast.

The goal of agents in this system is **separation of responsibility**, **hallucination control**, and **clear reasoning boundaries** between deterministic analysis and generative narration.

---

## Design Principles

1. **Deterministic before Generative**
   Agents that compute facts must run before agents that explain them.

2. **Single Responsibility per Agent**
   Each agent has one clear job and produces structured output.

3. **Evidence-Bound Communication**
   Agents communicate using schemas, not free text.

4. **Graceful Degradation**
   If an AI agent fails, deterministic agents still produce usable output.

---

## Agent Overview

```
CLI Agent
  -> Repo Scanner Agent
  -> Code Analysis Agent
  -> Insight Aggregator Agent
  -> Evidence Guard Agent
  -> Fix-It Agent (optional --fix)
  -> Fix-Apply Agent (optional --apply-fixes)
  -> Roast Narrator Agent (Gemini API)
  -> Output Formatter Agent
```

---

## 1. CLI Agent

**Type:** Deterministic  
**Role:** Entry point and command orchestration

### Responsibilities

* Parse CLI commands and flags
* Validate inputs
* Select analysis mode (severity, focus, output format)
* Trigger downstream agents in order

### Inputs

* Command arguments
* Flags (e.g. `--severity`, `--focus`)

### Outputs

```json
{
  "path": ".",
  "severity": "savage",
  "focus": "architecture"
}
```

---

## 2. Repo Scanner Agent

**Type:** Deterministic  
**Role:** Repository discovery and metadata extraction

### Responsibilities

* Traverse filesystem
* Respect `.gitignore`
* Detect languages and file types
* Identify entry points

### Outputs

```json
{
  "languages": ["ts", "js"],
  "fileCount": 128,
  "folders": 19,
  "entryPoints": ["src/index.ts"]
}
```

### Notes

* No code semantics here
* Pure structure and counts

---

## 3. Code Analysis Agent

**Type:** Deterministic  
**Role:** Static code analysis and signal extraction

### Responsibilities

* Parse ASTs
* Compute metrics
* Detect architectural and code smells
* Capture line ranges to support evidence

### Signals Produced

* Long functions
* Duplicate blocks
* Direct circular dependencies
* Test presence

Planned: god files, layer violations, dependency direction.

### Outputs

```json
{
  "metrics": {
    "maxFunctionLength": 311,
    "avgFunctionLength": 42,
    "duplicateBlocks": 7,
    "totalFunctions": 128
  },
  "signals": {
    "longFunctions": [
      {
        "file": "src/handlers/user.ts",
        "name": "saveUser",
        "length": 72,
        "startLine": 10,
        "endLine": 81
      }
    ],
    "duplicateBlocks": [
      {
        "hash": "a1b2c3",
        "length": 12,
        "occurrences": [
          { "file": "src/a.ts", "startLine": 20, "endLine": 31 }
        ]
      }
    ],
    "circularDependencies": [
      {
        "from": "src/a.ts",
        "to": "src/b.ts",
        "fromStartLine": 1,
        "fromEndLine": 1,
        "toStartLine": 1,
        "toEndLine": 1
      }
    ],
    "testPresence": {
      "hasTests": true,
      "testFiles": ["src/__tests__/smoke.test.ts"]
    }
  }
}
```

### Notes

* This agent does **not** interpret or judge
* It only reports facts

---

## 4. Insight Aggregator Agent

**Type:** Deterministic  
**Role:** Prepare LLM-safe context

### Responsibilities

* Merge scanner and analysis outputs
* Filter noise
* Attach confidence levels
* Build structured evidence entries

### Outputs

```json
{
  "issues": [
    {
      "type": "maintainability",
      "signal": "longFunctions",
      "confidence": "medium",
      "evidence": [
        {
          "file": "src/handlers/user.ts",
          "startLine": 10,
          "endLine": 81,
          "metrics": [{ "type": "loc", "value": 72 }]
        }
      ]
    }
  ]
}
```

### Notes

* This agent defines what the narrator is *allowed* to talk about
* Evidence entries must include file path, line range, and metrics

---

## 5. Evidence Guard Agent

**Type:** Deterministic  
**Role:** Validate evidence completeness and enforce narration boundaries

### Responsibilities

* Validate each issue has evidence entries with file path, line range, and metrics
* Mark issues as incomplete with a reason
* Gate what the narrator is allowed to say

### Outputs

```json
{
  "issues": [
    {
      "type": "testing",
      "signal": "testPresence",
      "confidence": "medium",
      "evidence": [],
      "evidenceComplete": false,
      "missingEvidenceReason": "No evidence items provided."
    }
  ]
}
```

### Notes

* If evidence is incomplete, the narrator must respond with "not enough data"

---

## 6. Fix-It Agent (optional --fix)

**Type:** Generative + Deterministic guard  
**Role:** Evidence-locked patch preview and verification

### Responsibilities

* Generate patch suggestions with Gemini using evidence-only prompts
* Reject any edit outside evidence line ranges
* Re-run analysis on patched content to verify improvement
* Emit unified diff previews only (no file writes)

### Configuration

* `GEMINI_API_KEY` or `GOOGLE_API_KEY` (required to enable fixes)
* `--fix` (enable fix-it previews)

### Hard Constraints

* Only touch files and line ranges present in evidence
* If verification fails, mark the suggestion as rejected

---

## 7. Fix-Apply Agent (optional --apply-fixes)

**Type:** Deterministic  
**Role:** Proof-locked application of fixes on a new git branch

### Responsibilities

* Apply verified Fix-It patches on a new git branch
* Run tests and only mark the apply as successful if tests pass
* Report branch name, test command, and pass/fail status

### Configuration

* `--apply-fixes` (enable apply)
* `--fix-branch <name>` (optional branch name)
* `--fix-test-cmd "<cmd>"` (optional test command override)

### Hard Constraints

* Must refuse to run on a dirty working tree
* Must not modify files if patch application fails

---

## 8. Roast Narrator Agent (Gemini API)

**Type:** Generative (Constrained)  
**Role:** Human-readable explanation and humor

### Responsibilities

* Generate roast-style feedback
* Explain issues using provided evidence
* Match selected tone (gentle, savage, investor-demo)
* Call Gemini API via the Google Gen AI SDK (`@google/genai`) with evidence-only prompts

### Configuration

* `GEMINI_API_KEY` or `GOOGLE_API_KEY` (required to enable Gemini)

### Hard Constraints

* Cannot introduce new issues
* Cannot infer unseen code
* Must reference provided evidence only
* If evidence is incomplete, respond with "not enough data"

### Prompt Guarantees

* Evidence-bound
* Structured sections
* Tone without factual drift

---

## 9. Output Formatter Agent

**Type:** Deterministic  
**Role:** UX presentation

### Responsibilities

* Format output for terminal
* Apply colors, emojis, scores
* Render sections consistently

### Output Example

```
Architecture Roast
Repo Status: Recovering
Score: 6.8 / 10
```

---

## Hallucination Safeguards (Agent-Level)

| Safeguard                         | Enforced By               |
| --------------------------------- | ------------------------- |
| No raw code to LLM                | Insight Aggregator        |
| Evidence completeness validation  | Evidence Guard            |
| Evidence-locked patch scope       | Fix-It Agent              |
| Evidence-only narration           | Evidence Guard + Narrator |
| Confidence labeling               | Aggregator                |
| Deterministic fallback            | Output Formatter          |

Worst case behavior:

> Output becomes factual and boring - never incorrect. If evidence is missing, the narrator says "not enough data".

---

## Implementation Plan (Gemini Integration)

1. Add a Gemini client module and strict evidence-only prompt builder.
2. Use `GEMINI_API_KEY` or `GOOGLE_API_KEY` to enable the narrator, with deterministic fallback when missing or on API error.
3. Wire Gemini into the pipeline using Evidence Guard output only.
4. Add tests with mocked Gemini responses and failure-mode fallback.

---

## Judge-Ready Summary

> CodeRoast uses a multi-agent pipeline where deterministic agents extract verifiable signals and a constrained generative agent narrates them. The Evidence Guard enforces evidence completeness, and the Fix-It Agent offers evidence-locked patch previews with verification.

---

## Future Agents (Post-Hackathon)

* CI Agent (GitHub Actions)
* Diff Agent (PR analysis)
* Trend Agent (historical repo health)
* Security Agent (OWASP-focused)

---

**End of Agents.md**
