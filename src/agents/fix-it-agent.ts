import fs from "node:fs/promises";
import path from "node:path";
import { callGemini } from "./gemini-client";
import { LONG_FUNCTION_LOC, runCodeAnalysisAgent } from "./code-analysis-agent";
import type {
  AnalysisResult,
  CliConfig,
  EvidenceItem,
  FixResult,
  FixSuggestion,
  GuardedIssue,
  GuardedInsights,
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
  const match = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
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
    const line = lines[i];
    if (line.startsWith("--- ")) {
      const oldPath = normalizeDiffPath(line.slice(4));
      const next = lines[i + 1] ?? "";
      if (!next.startsWith("+++ ")) {
        throw new Error("Malformed diff header.");
      }
      const newPath = normalizeDiffPath(next.slice(4));
      const filePath = newPath !== "/dev/null" ? newPath : oldPath;
      current = { filePath, hunks: [] };
      patches.push(current);
      currentHunk = null;
      i += 1;
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
  return [
    "You are a code fixer. Output ONLY a unified diff.",
    "You must only modify lines within the evidence line ranges provided.",
    "Do not add new files. Do not edit outside the ranges.",
    "Goal: reduce function length below the long-function threshold.",
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
  ].join("\n");
}

function buildDuplicatePrompt(
  issue: GuardedIssue,
  snippets: { file: string; startLine: number; endLine: number; text: string }[]
): string {
  return [
    "You are a code fixer. Output ONLY a unified diff.",
    "You must only modify lines within the evidence line ranges provided.",
    "Do not add new files. Do not edit outside the ranges.",
    "Goal: eliminate duplication by changing one occurrence.",
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
    temperature: 0.1,
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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = process.env.GEMINI_MODEL ?? "gemini-3-flash";
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
    patches = parseUnifiedDiff(patchText);
    if (patches.length === 0) {
      throw new Error("Empty patch response.");
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

  return { suggestions };
}
