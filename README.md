# CodeRoast

CodeRoast is an agent-based architecture for generating evidence-bound code reviews and "roasts" with strong separation between deterministic analysis and constrained narration.

## Overview

This repository currently contains the architecture specification in `AGENTS.md`. The design focuses on deterministic data extraction first, followed by a tightly constrained generative step for human-readable output.

## Architecture

Pipeline:

```
CLI Agent
  -> Repo Scanner Agent
  -> Code Analysis Agent
  -> Insight Aggregator Agent
  -> Roast Narrator Agent
  -> Output Formatter Agent
```

## Agents at a Glance

- CLI Agent: parses commands and orchestrates the pipeline
- Repo Scanner Agent: discovers files, languages, and entry points
- Code Analysis Agent: extracts structural signals and metrics
- Insight Aggregator Agent: merges findings and ranks issues with confidence
- Roast Narrator Agent: generates explanation constrained to evidence
- Output Formatter Agent: renders final output for the terminal

## Design Principles

- Deterministic before generative
- Single responsibility per agent
- Evidence-bound communication
- Graceful degradation when generative steps fail

## Hallucination Safeguards

- No raw code is sent to the narrator
- Narration is limited to known signals and evidence
- Confidence is attached to every issue

## Learn More

See `AGENTS.md` for the full specification and detailed agent responsibilities.
