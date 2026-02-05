import fs from "node:fs/promises";
import path from "node:path";
import { callGemini, getGeminiApiKey } from "./gemini-client";
import { LONG_FUNCTION_LOC, runCodeAnalysisAgent } from "./code-analysis-agent";
import type {
  AnalysisResult,
  CliConfig,
  EvidenceItem,
  FixResult,
  FixPreviewSummary,
  FixSuggestion,
  GuardedIssue,
  GuardedInsights,
  MetricDelta,
  RepoScanResult,
} from "../types";

type LineRange = { startLine: number; endLine: number };

type VerificationResult = {
  ok: boolean;
  message: string;
  details?: string;
};

type FilePatch = {
  filePath: string;
  hunks: Hunk[];
};

type Hunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
};

const FIXABLE_SIGNALS = new Set(["longFunctions", "duplicateBlocks"]);
const MAX_FIXES = 2;

function toAbsolutePath(rootPath: string, relativePath: string): string {
  const parts = relativePath.split("/");
  return path.resolve(rootPath, path.join(...parts));
}

function normalizeDiffPath(value: string): string {
  const cleaned = value.replace(/^\s+|\s+$/g, "");
  if (cleaned === "/dev/null") {
    return cleaned;
  }
  return cleaned.replace(/^a\//, "").replace(/^b\//, "");
}

function parseHunkHeader(line: string): Hunk | null {
  const match = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(line);
  if (!match) {
    return null;
  }
  return {
    oldStart: Number(match[1]),
    oldLines: Number(match[2] ?? "1"),
    newStart: Number(match[3]),
    newLines: Number(match[4] ?? "1"),
    lines: [],
  };
}

function parseUnifiedDiff(diff: string): FilePatch[] {
  const lines = diff.split(/\r?\n/);
  const patches: FilePatch[] = [];
  let current: FilePatch | null = null;
  let currentHunk: Hunk | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith("```")) {
      continue;
    }
    if (line.startsWith("diff --git")) {
      current = null;
      currentHunk = null;
      continue;
    }
    if (line.startsWith("index ")) {
      continue;
    }
    if (line.startsWith("--- ")) {
      const oldPath = normalizeDiffPath(line.slice(4));
      let nextIndex = i + 1;
      while (nextIndex < lines.length) {
        const candidate = (lines[nextIndex] ?? "").replace(/\r$/, "");
        if (candidate.startsWith("+++ ")) {
          break;
        }
        if (
          candidate.startsWith("--- ") ||
          candidate.startsWith("@@ ") ||
          candidate.startsWith("diff --git")
        ) {
          break;
        }
        if (candidate.startsWith("index ") || candidate.trim().length === 0) {
          nextIndex += 1;
          continue;
        }
        nextIndex += 1;
      }
      const next = lines[nextIndex] ?? "";
      if (!next.startsWith("+++ ")) {
        throw new Error("Malformed diff header.");
      }
      const newPath = normalizeDiffPath(next.slice(4));
      const filePath = newPath !== "/dev/null" ? newPath : oldPath;
      current = { filePath, hunks: [] };
      patches.push(current);
      currentHunk = null;
      i = nextIndex;
      continue;
    }

    if (line.startsWith("@@ ")) {
      if (!current) {
        throw new Error("Hunk found before file header.");
      }
      const hunk = parseHunkHeader(line);
      if (!hunk) {
        throw new Error("Malformed hunk header.");
      }
      current.hunks.push(hunk);
      currentHunk = hunk;
      continue;
    }

    if (!currentHunk) {
      continue;
    }

    if (line.startsWith("\\ No newline at end of file")) {
      continue;
    }
    currentHunk.lines.push(line);
  }

  return patches;
}

function hasPatchChanges(patches: FilePatch[]): boolean {
  for (const patch of patches) {
    for (const hunk of patch.hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith("+") || line.startsWith("-")) {
          if (line.startsWith("+++ ") || line.startsWith("--- ")) {
            continue;
          }
          return true;
        }
      }
    }
  }
  return false;
}

function applyPatchToContent(content: string, patch: FilePatch): string {
  const lines = content.split(/\r?\n/);
  const output: string[] = [];
  let cursor = 0;

  for (const hunk of patch.hunks) {
    const startIndex = hunk.oldStart - 1;
    if (startIndex < 0 || startIndex > lines.length) {
      throw new Error("Hunk start out of range.");
    }
    output.push(...lines.slice(cursor, startIndex));
    cursor = startIndex;

    for (const line of hunk.lines) {
      if (line.startsWith(" ")) {
        output.push(line.slice(1));
        cursor += 1;
      } else if (line.startsWith("-")) {
        cursor += 1;
      } else if (line.startsWith("+")) {
        output.push(line.slice(1));
      } else {
        throw new Error("Unexpected diff line.");
      }
    }
  }

  output.push(...lines.slice(cursor));
  return output.join("\n");
}

async function applyPatchesToOverrides(
  rootPath: string,
  patches: FilePatch[]
): Promise<Record<string, string>> {
  const overrides: Record<string, string> = {};
  const byFile = new Map<string, FilePatch[]>();
  for (const patch of patches) {
    const list = byFile.get(patch.filePath) ?? [];
    list.push(patch);
    byFile.set(patch.filePath, list);
  }

  for (const [filePath, filePatches] of byFile) {
    const absolutePath = toAbsolutePath(rootPath, filePath);
    const original = await fs.readFile(absolutePath, "utf8");
    let content = overrides[filePath] ?? original;
    for (const patch of filePatches) {
      content = applyPatchToContent(content, patch);
    }
    overrides[filePath] = content;
  }

  return overrides;
}

function buildMetricDelta(before: AnalysisResult, after: AnalysisResult): MetricDelta {
  return {
    maxFunctionLength: after.metrics.maxFunctionLength - before.metrics.maxFunctionLength,
    avgFunctionLength:
      Math.round((after.metrics.avgFunctionLength - before.metrics.avgFunctionLength) * 100) / 100,
    duplicateBlocks: after.metrics.duplicateBlocks - before.metrics.duplicateBlocks,
    totalFunctions: after.metrics.totalFunctions - before.metrics.totalFunctions,
  };
}

function lineInRanges(line: number, ranges: LineRange[]): boolean {
  return ranges.some((range) => line >= range.startLine && line <= range.endLine);
}

function patchWithinEvidence(
  patch: FilePatch[],
  allowed: Record<string, LineRange[]>
): { ok: boolean; reason?: string } {
  for (const filePatch of patch) {
    const ranges = allowed[filePatch.filePath];
    if (!ranges || ranges.length === 0) {
      return { ok: false, reason: `Patch touches non-evidence file: ${filePatch.filePath}` };
    }
    for (const hunk of filePatch.hunks) {
      let oldLine = hunk.oldStart;
      for (const line of hunk.lines) {
        if (line.startsWith("-")) {
          if (!lineInRanges(oldLine, ranges)) {
            return {
              ok: false,
              reason: `Patch removes line ${oldLine} outside evidence in ${filePatch.filePath}`,
            };
          }
          oldLine += 1;
        } else if (line.startsWith("+")) {
          if (!lineInRanges(oldLine, ranges)) {
            return {
              ok: false,
              reason: `Patch adds line outside evidence near ${oldLine} in ${filePatch.filePath}`,
            };
          }
        } else if (line.startsWith(" ")) {
          oldLine += 1;
        }
      }
    }
  }
  return { ok: true };
}

function buildAllowedRanges(issue: GuardedIssue): Record<string, LineRange[]> {
  return issue.evidence.reduce<Record<string, LineRange[]>>((acc, item) => {
    acc[item.file] = acc[item.file] ?? [];
    acc[item.file].push({ startLine: item.startLine, endLine: item.endLine });
    return acc;
  }, {});
}

function summarizeEvidence(issue: GuardedIssue): string {
  return issue.evidence
    .map((item) => `${item.file}:${item.startLine}-${item.endLine}`)
    .join("; ");
}

function buildNumberedSnippet(content: string, startLine: number, endLine: number): string {
  const lines = content.split(/\r?\n/);
  const slice = lines.slice(startLine - 1, endLine);
  return slice
    .map((line, index) => {
      const lineNo = startLine + index;
      return `${lineNo.toString().padStart(4, " ")} | ${line}`;
    })
    .join("\n");
}

async function readSnippet(
  rootPath: string,
  item: EvidenceItem
): Promise<{ file: string; startLine: number; endLine: number; text: string }> {
  const absolutePath = toAbsolutePath(rootPath, item.file);
  const content = await fs.readFile(absolutePath, "utf8");
  return {
    file: item.file,
    startLine: item.startLine,
    endLine: item.endLine,
    text: buildNumberedSnippet(content, item.startLine, item.endLine),
  };
}

function selectDuplicateEvidence(issue: GuardedIssue): EvidenceItem[] {
  const byFile = new Map<string, EvidenceItem[]>();
  for (const item of issue.evidence) {
    const list = byFile.get(item.file) ?? [];
    list.push(item);
    byFile.set(item.file, list);
  }
  for (const items of byFile.values()) {
    if (items.length >= 2) {
      return items.slice(0, 2);
    }
  }
  return [];
}

function buildLongFunctionPrompt(
  issue: GuardedIssue,
  snippets: { file: string; startLine: number; endLine: number; text: string }[]
): string {
  const templates = snippets.map((snippet) => {
    const length = Math.max(1, snippet.endLine - snippet.startLine + 1);
    return [
      `--- a/${snippet.file}`,
      `+++ b/${snippet.file}`,
      `@@ -${snippet.startLine},${length} +${snippet.startLine},${length} @@`,
      " <unchanged line>",
      "-<line to remove>",
      "+<line to add>",
      " <unchanged line>",
    ].join("\n");
  });

  return [
    "You are a code fixer. Output ONLY a unified diff.",
    "Return a complete unified diff with ---/+++ headers and @@ hunk headers.",
    "Do not wrap the diff in markdown fences or add commentary.",
    "Use the strict template below. Replace placeholders with real code.",
    "Choose one template and output only the filled diff.",
    "If you change line counts, adjust the @@ header lengths accordingly.",
    "You must only modify lines within the evidence line ranges provided.",
    "Do not add new files. Do not edit outside the ranges.",
    `Goal: reduce function length below ${LONG_FUNCTION_LOC} lines.`,
    "Ensure the diff includes at least one added or removed line.",
    "",
    `Issue type: ${issue.type}`,
    `Signal: ${issue.signal}`,
    `Evidence: ${summarizeEvidence(issue)}`,
    "",
    "Evidence snippets (with line numbers):",
    ...snippets.map(
      (snippet) =>
        `File: ${snippet.file} (${snippet.startLine}-${snippet.endLine})\n${snippet.text}`
    ),
    "",
    "Strict diff template (fill in one of these):",
    ...templates,
  ].join("\n");
}

function buildDuplicatePrompt(
  issue: GuardedIssue,
  snippets: { file: string; startLine: number; endLine: number; text: string }[]
): string {
  const templates = snippets.map((snippet) => {
    const length = Math.max(1, snippet.endLine - snippet.startLine + 1);
    return [
      `--- a/${snippet.file}`,
      `+++ b/${snippet.file}`,
      `@@ -${snippet.startLine},${length} +${snippet.startLine},${length} @@`,
      " <unchanged line>",
      "-<line to remove>",
      "+<line to add>",
      " <unchanged line>",
    ].join("\n");
  });

  return [
    "You are a code fixer. Output ONLY a unified diff.",
    "Return a complete unified diff with ---/+++ headers and @@ hunk headers.",
    "Do not wrap the diff in markdown fences or add commentary.",
    "Use the strict template below. Replace placeholders with real code.",
    "Choose one template and output only the filled diff.",
    "If you change line counts, adjust the @@ header lengths accordingly.",
    "You must only modify lines within the evidence line ranges provided.",
    "Do not add new files. Do not edit outside the ranges.",
    "Goal: eliminate duplication by changing one occurrence.",
    "Ensure the diff includes at least one added or removed line.",
    "",
    `Issue type: ${issue.type}`,
    `Signal: ${issue.signal}`,
    `Evidence: ${summarizeEvidence(issue)}`,
    "",
    "Evidence snippets (with line numbers):",
    ...snippets.map(
      (snippet) =>
        `File: ${snippet.file} (${snippet.startLine}-${snippet.endLine})\n${snippet.text}`
    ),
    "",
    "Strict diff template (fill in one of these):",
    ...templates,
  ].join("\n");
}

function buildRetryPrompt(basePrompt: string, reason: string): string {
  return [
    `Previous output was invalid: ${reason}`,
    "You MUST return ONLY a valid unified diff.",
    "Do not include diff --git or index lines.",
    "Do not include markdown or commentary.",
    "Use the strict template exactly.",
    "",
    basePrompt,
  ].join("\n");
}

function findMaxLongFunctionInRange(
  longFunctions: AnalysisResult["signals"]["longFunctions"],
  file: string,
  range: LineRange
): number {
  const matches = longFunctions.filter(
    (fn) =>
      fn.file === file &&
      fn.startLine <= range.endLine &&
      fn.endLine >= range.startLine &&
      fn.length >= LONG_FUNCTION_LOC
  );
  if (matches.length === 0) {
    return 0;
  }
  return Math.max(...matches.map((fn) => fn.length));
}

function verifyLongFunctionFix(
  before: AnalysisResult,
  after: AnalysisResult,
  evidence: EvidenceItem
): VerificationResult {
  const range = { startLine: evidence.startLine, endLine: evidence.endLine };
  const beforeMax = findMaxLongFunctionInRange(
    before.signals.longFunctions,
    evidence.file,
    range
  );
  const afterMax = findMaxLongFunctionInRange(
    after.signals.longFunctions,
    evidence.file,
    range
  );
  if (beforeMax === 0) {
    return { ok: false, message: "No long function found in evidence range." };
  }
  const afterLabel = afterMax === 0 ? `< ${LONG_FUNCTION_LOC}` : `${afterMax}`;
  const details = `longFunctionLength: ${beforeMax} -> ${afterLabel}`;
  if (afterMax === 0 || afterMax < beforeMax) {
    return { ok: true, message: "Long function length reduced.", details };
  }
  return { ok: false, message: "Long function length did not improve.", details };
}

function verifyDuplicateFix(
  before: AnalysisResult,
  after: AnalysisResult
): VerificationResult {
  const details = `duplicateBlocks: ${before.metrics.duplicateBlocks} -> ${after.metrics.duplicateBlocks}`;
  if (after.metrics.duplicateBlocks < before.metrics.duplicateBlocks) {
    return { ok: true, message: "Duplicate blocks reduced.", details };
  }
  return { ok: false, message: "Duplicate blocks did not improve.", details };
}

async function generatePatch(
  apiKey: string,
  model: string,
  prompt: string
): Promise<string> {
  return callGemini({
    apiKey,
    model,
    prompt,
    temperature: 0,
    maxOutputTokens: 900,
  });
}

async function attemptFix(
  issueId: number,
  issue: GuardedIssue,
  config: CliConfig,
  scan: RepoScanResult,
  analysis: AnalysisResult
): Promise<FixSuggestion | null> {
  if (!issue.evidenceComplete) {
    return null;
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return null;
  }

  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const rootPath = path.resolve(config.path);

  let prompt = "";
  let evidenceItems: EvidenceItem[] = [];
  if (issue.signal === "longFunctions") {
    evidenceItems = issue.evidence.slice(0, 1);
    if (evidenceItems.length === 0) {
      return null;
    }
    const snippets = await Promise.all(
      evidenceItems.map((item) => readSnippet(rootPath, item))
    );
    prompt = buildLongFunctionPrompt(issue, snippets);
  } else if (issue.signal === "duplicateBlocks") {
    evidenceItems = selectDuplicateEvidence(issue);
    if (evidenceItems.length < 2) {
      return null;
    }
    const snippets = await Promise.all(
      evidenceItems.map((item) => readSnippet(rootPath, item))
    );
    prompt = buildDuplicatePrompt(issue, snippets);
  } else {
    return null;
  }

  let patchText = "";
  let patches: FilePatch[] = [];
  const allowedRanges = buildAllowedRanges(issue);

  try {
    patchText = await generatePatch(apiKey, model, prompt);
    try {
      patches = parseUnifiedDiff(patchText);
      if (patches.length === 0) {
        throw new Error("Empty patch response.");
      }
      if (!hasPatchChanges(patches)) {
        throw new Error("Patch contains no changes.");
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Invalid patch.";
      const retryPrompt = buildRetryPrompt(prompt, reason);
      patchText = await generatePatch(apiKey, model, retryPrompt);
      patches = parseUnifiedDiff(patchText);
      if (patches.length === 0) {
        throw new Error("Empty patch response.");
      }
      if (!hasPatchChanges(patches)) {
        throw new Error("Patch contains no changes.");
      }
    }
  } catch (error) {
    return {
      issueId,
      issueType: issue.type,
      signal: issue.signal,
      files: Object.keys(allowedRanges),
      patch: "",
      verified: false,
      verificationMessage: error instanceof Error ? error.message : "Invalid patch.",
    };
  }

  const guard = patchWithinEvidence(patches, allowedRanges);
  if (!guard.ok) {
    return {
      issueId,
      issueType: issue.type,
      signal: issue.signal,
      files: Object.keys(allowedRanges),
      patch: "",
      verified: false,
      verificationMessage: guard.reason ?? "Patch rejected by evidence guard.",
    };
  }

  const overrides: Record<string, string> = {};
  for (const filePatch of patches) {
    const absolutePath = toAbsolutePath(rootPath, filePatch.filePath);
    const content = await fs.readFile(absolutePath, "utf8");
    overrides[filePatch.filePath] = applyPatchToContent(content, filePatch);
  }

  const updatedAnalysis = await runCodeAnalysisAgent(config, scan, overrides);

  let verification: VerificationResult = {
    ok: false,
    message: "No verification available.",
  };
  if (issue.signal === "longFunctions" && evidenceItems[0]) {
    verification = verifyLongFunctionFix(analysis, updatedAnalysis, evidenceItems[0]);
  } else if (issue.signal === "duplicateBlocks") {
    verification = verifyDuplicateFix(analysis, updatedAnalysis);
  }

  return {
    issueId,
    issueType: issue.type,
    signal: issue.signal,
    files: Object.keys(allowedRanges),
    patch: patchText.trim(),
    verified: verification.ok,
    verificationMessage: verification.message,
    verificationDetails: verification.details,
  };
}

async function buildPreviewSummary(
  config: CliConfig,
  scan: RepoScanResult,
  analysis: AnalysisResult,
  suggestions: FixSuggestion[]
): Promise<FixPreviewSummary | undefined> {
  const verifiedPatches = suggestions
    .filter((suggestion) => suggestion.verified && suggestion.patch)
    .flatMap((suggestion) => parseUnifiedDiff(suggestion.patch));

  if (verifiedPatches.length === 0) {
    return { before: analysis.metrics, note: "No verified patches to compare yet." };
  }

  const rootPath = path.resolve(config.path);
  const overrides = await applyPatchesToOverrides(rootPath, verifiedPatches);
  const after = await runCodeAnalysisAgent(config, scan, overrides);
  const delta = buildMetricDelta(analysis, after);

  return {
    before: analysis.metrics,
    after: after.metrics,
    delta,
    note: "Preview metrics are based on verified patch candidates.",
  };
}

export async function runFixItAgent(
  config: CliConfig,
  scan: RepoScanResult,
  analysis: AnalysisResult,
  insights: GuardedInsights
): Promise<FixResult> {
  const suggestions: FixSuggestion[] = [];
  const candidates = insights.issues.filter((issue) =>
    FIXABLE_SIGNALS.has(issue.signal)
  );

  for (const [index, issue] of candidates.slice(0, MAX_FIXES).entries()) {
    const suggestion = await attemptFix(index + 1, issue, config, scan, analysis);
    if (!suggestion) {
      continue;
    }
    suggestions.push(suggestion);
  }

  const previewSummary = await buildPreviewSummary(config, scan, analysis, suggestions);

  return { suggestions, previewSummary };
}
