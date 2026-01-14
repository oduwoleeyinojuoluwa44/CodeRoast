import type { CliConfig, EvidenceItem, GuardedInsights, RoastResult } from "../types";

function formatEvidenceItem(item: EvidenceItem): string {
  const metrics = item.metrics
    .map((metric) => `${metric.type}=${metric.value}`)
    .join(", ");
  return `${item.file}:${item.startLine}-${item.endLine} (${metrics})`;
}

function formatIssueLine(
  index: number,
  issue: { type: string; evidence: EvidenceItem[]; evidenceComplete: boolean }
): string {
  if (!issue.evidenceComplete) {
    return `${index + 1}. [${issue.type}] not enough data`;
  }
  const evidenceText = issue.evidence.map(formatEvidenceItem).join("; ");
  return `${index + 1}. [${issue.type}] ${evidenceText}`;
}

export function runRoastNarratorAgent(
  config: CliConfig,
  insights: GuardedInsights
): RoastResult {
  if (insights.issues.length === 0) {
    return {
      content: `No issues detected for ${config.focus}. Add analyzers to produce evidence-bound findings.`,
    };
  }

  const lines = insights.issues.map((issue, index) =>
    formatIssueLine(index, issue)
  );
  return {
    content: lines.join("\n"),
  };
}
