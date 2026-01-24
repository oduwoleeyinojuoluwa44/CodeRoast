import { callGeminiNarrator } from "./gemini-client";
import type {
  CliConfig,
  EvidenceItem,
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

function buildDeterministicMessage(issue: GuardedIssue): string {
  if (!issue.evidenceComplete) {
    return "not enough data";
  }
  const evidenceText = issue.evidence.map(formatEvidenceItem).join("; ");
  return evidenceText.length > 0 ? evidenceText : "not enough data";
}

function formatIssueLine(index: number, issue: GuardedIssue, message: string): string {
  return `${index + 1}. [${issue.type}] ${message}`;
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
    };
  }

  const fallbackLines = insights.issues.map((issue, index) =>
    formatIssueLine(index, issue, buildDeterministicMessage(issue))
  );

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { content: fallbackLines.join("\n") };
  }

  const model = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
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
        return formatIssueLine(index, issue, "not enough data");
      }
      const geminiText = byId.get(issue.id);
      if (!geminiText) {
        return fallbackLines[index];
      }
      if (geminiText.toLowerCase() === "not enough data") {
        return fallbackLines[index];
      }
      return formatIssueLine(index, issue, geminiText);
    });

    return { content: lines.join("\n") };
  } catch {
    return { content: fallbackLines.join("\n") };
  }
}
