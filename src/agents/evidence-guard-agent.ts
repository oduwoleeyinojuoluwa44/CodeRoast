import type { AggregatedInsights, GuardedInsights, GuardedIssue } from "../types";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidLine(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isValidMetricValue(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return false;
}

function validateEvidence(issue: GuardedIssue): GuardedIssue {
  if (!issue.evidence || issue.evidence.length === 0) {
    return {
      ...issue,
      evidenceComplete: false,
      missingEvidenceReason: "No evidence items provided.",
    };
  }

  for (const item of issue.evidence) {
    if (!isNonEmptyString(item.file)) {
      return {
        ...issue,
        evidenceComplete: false,
        missingEvidenceReason: "Evidence item missing file path.",
      };
    }
    if (!isValidLine(item.startLine) || !isValidLine(item.endLine)) {
      return {
        ...issue,
        evidenceComplete: false,
        missingEvidenceReason: "Evidence item missing line range.",
      };
    }
    if (item.endLine < item.startLine) {
      return {
        ...issue,
        evidenceComplete: false,
        missingEvidenceReason: "Evidence item line range is invalid.",
      };
    }
    if (!item.metrics || item.metrics.length === 0) {
      return {
        ...issue,
        evidenceComplete: false,
        missingEvidenceReason: "Evidence item missing metrics.",
      };
    }
    for (const metric of item.metrics) {
      if (!metric.type || !isValidMetricValue(metric.value)) {
        return {
          ...issue,
          evidenceComplete: false,
          missingEvidenceReason: "Evidence item has invalid metric.",
        };
      }
    }
  }

  return { ...issue, evidenceComplete: true };
}

export function runEvidenceGuardAgent(
  insights: AggregatedInsights
): GuardedInsights {
  const issues = insights.issues.map((issue) =>
    validateEvidence({ ...issue, evidenceComplete: true })
  );

  return { issues };
}
