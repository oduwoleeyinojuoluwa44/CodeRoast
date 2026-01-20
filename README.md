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
  -> Evidence Guard Agent
  -> Roast Narrator Agent
  -> Output Formatter Agent
```

## Agents at a Glance

- CLI Agent: parses commands and orchestrates the pipeline
- Repo Scanner Agent: discovers files, languages, and entry points
- Code Analysis Agent: extracts structural signals and metrics
- Insight Aggregator Agent: merges findings and ranks issues with confidence
- Evidence Guard Agent: validates evidence completeness and gates narration
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
- Evidence completeness is validated before narration
- Confidence is attached to every issue

## Getting Started

1. Install dependencies:

```
npm install
```

2. Build the project:

```
npm run build
```

3. (Optional) Enable Gemini narration:

```
set GEMINI_API_KEY=your_api_key
```

4. Run the CLI:

```
npm start -- --path . --severity savage --focus architecture
```

5. (Optional) Preview evidence-locked fixes:

```
npm start -- --path . --fix
```

Fix-It only outputs patch previews and does not edit files.

## Scripts

- `npm run lint` - run ESLint
- `npm run lint:fix` - auto-fix lint issues
- `npm run demo:fix` - create a demo repo and run Fix-It (requires `GEMINI_API_KEY` for suggestions)
- `npm run typecheck` - run TypeScript in no-emit mode
- `npm run build` - compile to `dist/`
- `npm start` - run the compiled CLI
- `npm test` - build and run the test suite

## Project Structure

- `src/index.ts` - CLI entry point
- `src/pipeline.ts` - agent pipeline orchestrator
- `src/agents/` - agent implementations
- `src/types.ts` - shared types and schemas

## Learn More

See `AGENTS.md` for the full specification and detailed agent responsibilities.
