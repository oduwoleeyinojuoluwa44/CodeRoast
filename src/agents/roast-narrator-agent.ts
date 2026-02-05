import { callGeminiNarrator, getGeminiApiKey } from "./gemini-client";
import type {
  CliConfig,
  EvidenceItem,
  EvidenceMetric,
  GuardedInsights,
  GuardedIssue,
  RoastResult,
} from "../types";

function formatEvidenceItem(item: EvidenceItem): string {
  const metrics = item.metrics
    .map((metric) => `${metric.type}=${metric.value}`)
    .join(", ");
  return `${item.file}:${item.startLine}-${item.endLine} (${metrics})`;
}

function getMetricValue(metrics: EvidenceMetric[], type: EvidenceMetric["type"]) {
  return metrics.find((metric) => metric.type === type)?.value;
}

function formatEvidenceExample(item: EvidenceItem): string {
  const loc = getMetricValue(item.metrics, "loc");
  const locText = typeof loc === "number" ? ` (${loc} lines)` : "";
  return `${item.file} lines ${item.startLine}-${item.endLine}${locText}`;
}

function buildLongFunctionMessage(issue: GuardedIssue): string {
  const example = issue.evidence[0];
  if (!example) {
    return "Long functions detected, but the evidence list is empty.";
  }
  const extraCount = issue.evidence.length - 1;
  const extraText = extraCount > 0 ? ` (+${extraCount} more)` : "";
  return `Very long functions can be hard to maintain, for example ${formatEvidenceExample(
    example
  )}${extraText}.`;
}

function buildDuplicateMessage(issue: GuardedIssue): string {
  const byHash = new Map<
    string,
    { count?: number; loc?: number; examples: EvidenceItem[] }
  >();

  for (const item of issue.evidence) {
    const hash = String(getMetricValue(item.metrics, "hash") ?? "unknown");
    const count = getMetricValue(item.metrics, "count");
    const loc = getMetricValue(item.metrics, "loc");
    const entry = byHash.get(hash) ?? {
      count: typeof count === "number" ? count : undefined,
      loc: typeof loc === "number" ? loc : undefined,
      examples: [],
    };
    entry.examples.push(item);
    if (typeof count === "number") {
      entry.count = count;
    }
    if (typeof loc === "number") {
      entry.loc = loc;
    }
    byHash.set(hash, entry);
  }

  const firstBlock = [...byHash.values()].sort((a, b) => {
    const countA = a.count ?? 0;
    const countB = b.count ?? 0;
    return countB - countA;
  })[0];

  if (!firstBlock || firstBlock.examples.length === 0) {
    return "Repeated code detected, but the evidence list is empty.";
  }

  const example = firstBlock.examples[0];
  const countText =
    typeof firstBlock.count === "number"
      ? ` (${firstBlock.count} total copies)`
      : "";
  const locText =
    typeof firstBlock.loc === "number" ? ` (~${firstBlock.loc} lines)` : "";

  if (!example) {
    return `Repeated code${locText} appears in multiple places${countText}.`;
  }
  return `Repeated code${locText} appears in multiple places${countText}, for example ${formatEvidenceExample(
    example
  )}.`;
}

function buildCircularMessage(issue: GuardedIssue): string {
  const unique = Array.from(
    new Map(issue.evidence.map((item) => [item.file, item])).values()
  );
  if (unique.length === 0) {
    return "Possible circular dependency detected, but the evidence list is empty.";
  }
  const examples = unique.slice(0, 2).map(formatEvidenceExample);
  if (examples.length === 1) {
    return `Possible circular dependency involving ${examples[0]}.`;
  }
  return `Possible circular dependency between ${examples[0]} and ${examples[1]}.`;
}

function buildLaymanMessage(issue: GuardedIssue): string {
  if (!issue.evidenceComplete) {
    return "not enough data";
  }
  switch (issue.signal) {
    case "longFunctions":
      return buildLongFunctionMessage(issue);
    case "duplicateBlocks":
      return buildDuplicateMessage(issue);
    case "circularDependencies":
      return buildCircularMessage(issue);
    case "testPresence":
      return "not enough data";
    default: {
      const example = issue.evidence[0];
      if (!example) {
        return "Issue detected, but the evidence list is empty.";
      }
      return `Potential issue spotted around ${formatEvidenceExample(example)}.`;
    }
  }
}

function buildActionItem(issue: GuardedIssue): string | null {
  if (!issue.evidenceComplete) {
    if (issue.signal === "testPresence") {
      return "Add at least one test file to cover critical paths.";
    }
    return null;
  }

  const example = issue.evidence[0];
  switch (issue.signal) {
    case "longFunctions": {
      if (!example) {
        return "Split long functions into smaller helpers.";
      }
      return `Split ${example.file} around lines ${example.startLine}-${example.endLine} into smaller helpers.`;
    }
    case "duplicateBlocks": {
      if (!example) {
        return "Extract repeated logic into a shared helper.";
      }
      return `Extract repeated logic around ${example.file} lines ${example.startLine}-${example.endLine} into a shared helper.`;
    }
    case "circularDependencies": {
      if (!example) {
        return "Break circular dependencies by moving shared code into a lower-level module.";
      }
      return `Break the dependency loop involving ${example.file} (lines ${example.startLine}-${example.endLine}).`;
    }
    case "testPresence":
      return "Add at least one test file to cover critical paths.";
    default:
      if (!example) {
        return "Create a focused refactor for the flagged area.";
      }
      return `Review ${example.file} lines ${example.startLine}-${example.endLine} for a focused refactor.`;
  }
}

function formatEvidenceList(issue: GuardedIssue, limit?: number): string {
  if (issue.evidence.length === 0) {
    return "   Evidence: none";
  }
  const maxItems = limit === undefined ? 3 : limit <= 0 ? issue.evidence.length : limit;
  const shown = issue.evidence.slice(0, maxItems);
  const lines = shown.map((item) => `   - ${formatEvidenceItem(item)}`);
  const remaining = issue.evidence.length - shown.length;
  if (remaining > 0) {
    lines.push(`   - ... +${remaining} more`);
  }
  return ["   Evidence:", ...lines].join("\n");
}

function formatIssueLine(
  index: number,
  issue: GuardedIssue,
  message: string,
  showDetails?: boolean,
  detailsLimit?: number
): string {
  const base = `${index + 1}. [${issue.type}] ${message}`;
  if (!showDetails) {
    return base;
  }
  return `${base}\n${formatEvidenceList(issue, detailsLimit)}`;
}

type NarrationIssue = GuardedIssue & { id: number };

function buildGeminiPrompt(
  config: CliConfig,
  issues: NarrationIssue[]
): string {
  const payload = issues.map((issue) => ({
    id: issue.id,
    type: issue.type,
    signal: issue.signal,
    confidence: issue.confidence,
    evidenceComplete: issue.evidenceComplete,
    evidence: issue.evidence,
  }));

  return [
    "You are CodeRoast, a strict evidence-only code review narrator.",
    "Use plain, non-technical language that a non-engineer can understand.",
    "Use only the evidence provided in the JSON below.",
    "Do not invent details or add new issues.",
    "If evidenceComplete is false or evidence is empty, output \"not enough data\".",
    `Tone: ${config.severity}. Focus: ${config.focus}.`,
    "Return ONLY valid JSON, no markdown or extra text.",
    "Output format: [{\"id\":1,\"text\":\"...\"}].",
    "Each text must be one sentence and should reference file paths and line ranges.",
    "",
    "Issues JSON:",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

type GeminiNarrationItem = {
  id: number;
  text: string;
};

function extractJsonArray(raw: string): GeminiNarrationItem[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Gemini response missing JSON array");
  }
  const jsonText = raw.slice(start, end + 1);
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) {
    throw new Error("Gemini response JSON is not an array");
  }
  return parsed as GeminiNarrationItem[];
}

function normalizeGeminiText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export async function runRoastNarratorAgent(
  config: CliConfig,
  insights: GuardedInsights
): Promise<RoastResult> {
  if (insights.issues.length === 0) {
    return {
      content: `No issues detected for ${config.focus}. Add analyzers to produce evidence-bound findings.`,
      usedGemini: false,
    };
  }

  const fallbackLines = insights.issues.map((issue, index) =>
    formatIssueLine(
      index,
      issue,
      buildLaymanMessage(issue),
      config.showDetails,
      config.detailsLimit
    )
  );

  const actionItems = insights.issues
    .map(buildActionItem)
    .filter((item): item is string => Boolean(item));

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return {
      content: fallbackLines.join("\n\n"),
      usedGemini: false,
      actionItems,
    };
  }

  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const issuesWithId: NarrationIssue[] = insights.issues.map((issue, index) => ({
    ...issue,
    id: index + 1,
  }));

  try {
    const prompt = buildGeminiPrompt(config, issuesWithId);
    const responseText = await callGeminiNarrator({
      apiKey,
      model,
      prompt,
    });
    const parsed = extractJsonArray(responseText);
    const byId = new Map<number, string>();
    for (const item of parsed) {
      if (typeof item?.id !== "number" || typeof item?.text !== "string") {
        continue;
      }
      byId.set(item.id, normalizeGeminiText(item.text));
    }

    const lines = issuesWithId.map((issue, index) => {
      if (!issue.evidenceComplete) {
        return formatIssueLine(
          index,
          issue,
          "not enough data",
          config.showDetails,
          config.detailsLimit
        );
      }
      const geminiText = byId.get(issue.id);
      if (!geminiText) {
        return fallbackLines[index];
      }
      if (geminiText.toLowerCase() === "not enough data") {
        return fallbackLines[index];
      }
      return formatIssueLine(
        index,
        issue,
        geminiText,
        config.showDetails,
        config.detailsLimit
      );
    });

    return { content: lines.join("\n\n"), usedGemini: true };
  } catch {
    return {
      content: fallbackLines.join("\n\n"),
      usedGemini: false,
      actionItems,
    };
  }
}
