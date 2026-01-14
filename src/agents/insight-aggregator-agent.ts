import type {
  AnalysisResult,
  AggregatedInsights,
  EvidenceItem,
  Issue,
  RepoScanResult,
} from "../types";

const MAX_LONG_FUNCTIONS = 5;
const MAX_DUPLICATE_BLOCKS = 3;
const MAX_DUPLICATE_OCCURRENCES = 3;
const MAX_CIRCULAR_CYCLES = 3;

function buildLongFunctionEvidence(
  longFunctions: AnalysisResult["signals"]["longFunctions"]
): EvidenceItem[] {
  return [...longFunctions]
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_LONG_FUNCTIONS)
    .map((fn) => ({
      file: fn.file,
      startLine: fn.startLine,
      endLine: fn.endLine,
      metrics: [{ type: "loc", value: fn.length }],
    }));
}

function buildDuplicateEvidence(
  duplicateBlocks: AnalysisResult["signals"]["duplicateBlocks"]
): EvidenceItem[] {
  const blocks = [...duplicateBlocks]
    .sort(
      (a, b) =>
        b.occurrences.length - a.occurrences.length || b.length - a.length
    )
    .slice(0, MAX_DUPLICATE_BLOCKS);

  const evidence: EvidenceItem[] = [];
  for (const block of blocks) {
    const occurrences = block.occurrences.slice(0, MAX_DUPLICATE_OCCURRENCES);
    for (const occurrence of occurrences) {
      evidence.push({
        file: occurrence.file,
        startLine: occurrence.startLine,
        endLine: occurrence.endLine,
        metrics: [
          { type: "loc", value: block.length },
          { type: "count", value: block.occurrences.length },
          { type: "hash", value: block.hash },
        ],
      });
    }
  }

  return evidence;
}

function buildCircularEvidence(
  circularDependencies: AnalysisResult["signals"]["circularDependencies"]
): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];
  const cycles = circularDependencies.slice(0, MAX_CIRCULAR_CYCLES);
  for (const cycle of cycles) {
    evidence.push({
      file: cycle.from,
      startLine: cycle.fromStartLine,
      endLine: cycle.fromEndLine,
      metrics: [{ type: "count", value: 1 }],
    });
    evidence.push({
      file: cycle.to,
      startLine: cycle.toStartLine,
      endLine: cycle.toEndLine,
      metrics: [{ type: "count", value: 1 }],
    });
  }
  return evidence;
}

export function runInsightAggregatorAgent(
  _scan: RepoScanResult,
  analysis: AnalysisResult
): AggregatedInsights {
  const issues: Issue[] = [];

  if (analysis.signals.longFunctions.length > 0) {
    issues.push({
      type: "maintainability",
      signal: "longFunctions",
      confidence: "medium",
      evidence: buildLongFunctionEvidence(analysis.signals.longFunctions),
    });
  }

  if (analysis.signals.duplicateBlocks.length > 0) {
    issues.push({
      type: "duplication",
      signal: "duplicateBlocks",
      confidence: "high",
      evidence: buildDuplicateEvidence(analysis.signals.duplicateBlocks),
    });
  }

  if (analysis.signals.circularDependencies.length > 0) {
    issues.push({
      type: "architecture",
      signal: "circularDependencies",
      confidence: "high",
      evidence: buildCircularEvidence(analysis.signals.circularDependencies),
    });
  }

  if (!analysis.signals.testPresence.hasTests) {
    issues.push({
      type: "testing",
      signal: "testPresence",
      confidence: "medium",
      evidence: [],
    });
  }

  return { issues };
}
