import type { AnalysisResult, AggregatedInsights, Issue, RepoScanResult } from "../types";

export function runInsightAggregatorAgent(
  _scan: RepoScanResult,
  analysis: AnalysisResult
): AggregatedInsights {
  const issues: Issue[] = [];

  if (analysis.signals.businessLogicInControllers) {
    issues.push({
      type: "architecture",
      signal: "businessLogicInControllers",
      confidence: "high",
      evidence: "Detected domain logic inside controller files.",
    });
  }

  if (analysis.signals.circularDependencies) {
    issues.push({
      type: "architecture",
      signal: "circularDependencies",
      confidence: "high",
      evidence: "Circular dependencies detected between modules.",
    });
  }

  if (analysis.signals.testCoverage === "low") {
    issues.push({
      type: "testing",
      signal: "testCoverage",
      confidence: "medium",
      evidence: "Test coverage appears lower than expected.",
    });
  }

  return { issues };
}
