import { DUPLICATE_MIN_LINES, LONG_FUNCTION_LOC } from "./code-analysis-agent";
import type { AnalysisResult, AggregatedInsights, Issue, RepoScanResult } from "../types";

export function runInsightAggregatorAgent(
  _scan: RepoScanResult,
  analysis: AnalysisResult
): AggregatedInsights {
  const issues: Issue[] = [];

  if (analysis.signals.longFunctions.length > 0) {
    const count = analysis.signals.longFunctions.length;
    const maxLength = analysis.metrics.maxFunctionLength;
    issues.push({
      type: "maintainability",
      signal: "longFunctions",
      confidence: "medium",
      evidence: `Detected ${count} functions >= ${LONG_FUNCTION_LOC} LOC (max ${maxLength}).`,
    });
  }

  if (analysis.signals.duplicateBlocks.length > 0) {
    const count = analysis.signals.duplicateBlocks.length;
    const occurrences = analysis.signals.duplicateBlocks.reduce(
      (total, block) => total + block.occurrences.length,
      0
    );
    issues.push({
      type: "duplication",
      signal: "duplicateBlocks",
      confidence: "high",
      evidence: `Detected ${count} duplicate blocks (>= ${DUPLICATE_MIN_LINES} lines, ${occurrences} occurrences).`,
    });
  }

  if (analysis.signals.circularDependencies.length > 0) {
    const sample = analysis.signals.circularDependencies
      .slice(0, 3)
      .map((cycle) => `${cycle.from} <-> ${cycle.to}`)
      .join("; ");
    issues.push({
      type: "architecture",
      signal: "circularDependencies",
      confidence: "high",
      evidence: `Detected ${analysis.signals.circularDependencies.length} direct circular dependencies${
        sample ? `: ${sample}` : "."
      }`,
    });
  }

  if (!analysis.signals.testPresence.hasTests) {
    issues.push({
      type: "testing",
      signal: "testPresence",
      confidence: "medium",
      evidence: "No test files detected.",
    });
  }

  return { issues };
}
