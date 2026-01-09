import type { AggregatedInsights, CliConfig, RoastResult } from "../types";

function formatIssueLine(index: number, issue: { type: string; evidence: string }): string {
  return `${index + 1}. [${issue.type}] ${issue.evidence}`;
}

export function runRoastNarratorAgent(
  config: CliConfig,
  insights: AggregatedInsights
): RoastResult {
  if (insights.issues.length === 0) {
    return {
      content: `No issues detected for ${config.focus}. Add analyzers to produce evidence-bound findings.`,
    };
  }

  const lines = insights.issues.map((issue, index) => formatIssueLine(index, issue));
  return {
    content: lines.join("\n"),
  };
}
