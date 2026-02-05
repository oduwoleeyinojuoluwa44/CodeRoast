import type {
  AnalysisResult,
  CliConfig,
  FixApplyResult,
  FixResult,
  FixSuggestion,
  FixPreviewSummary,
  FormattedOutput,
  RoastResult,
} from "../types";

function humanizeFixMessage(message: string): string {
  const mappings: { pattern: RegExp; replacement: string }[] = [
    {
      pattern: /Malformed hunk header/i,
      replacement: "The AI response was not a valid patch format.",
    },
    {
      pattern: /Patch contains no changes/i,
      replacement: "The AI did not include any actual code changes.",
    },
    {
      pattern: /outside evidence/i,
      replacement: "The change touched code outside the allowed evidence range.",
    },
    {
      pattern: /Empty patch response/i,
      replacement: "The AI did not return a patch.",
    },
    {
      pattern: /Long function length reduced/i,
      replacement: "This change would shorten a long function.",
    },
    {
      pattern: /Long function length did not improve/i,
      replacement: "This change does not shorten the long function.",
    },
    {
      pattern: /Duplicate blocks reduced/i,
      replacement: "This change would reduce repeated code.",
    },
    {
      pattern: /Duplicate blocks did not improve/i,
      replacement: "This change does not reduce repeated code.",
    },
  ];

  for (const mapping of mappings) {
    if (mapping.pattern.test(message)) {
      return mapping.replacement;
    }
  }

  return message;
}

function formatFixSummary(suggestion: FixSuggestion): string {
  const status = suggestion.verified ? "Fix preview looks good" : "Fix preview failed";
  const detail = humanizeFixMessage(suggestion.verificationMessage);
  return `${suggestion.issueId}. [${suggestion.issueType}] ${status}: ${detail}`;
}

function formatPreviewSummary(summary: FixPreviewSummary): string[] {
  const lines: string[] = ["", "Impact Summary (preview)"];
  const before = summary.before;
  if (!summary.after || !summary.delta) {
    lines.push("No verified patches to compare yet.");
    return lines;
  }
  const after = summary.after;
  const delta = summary.delta;
  lines.push(
    `Max function length: ${before.maxFunctionLength} -> ${after.maxFunctionLength} (${delta.maxFunctionLength})`
  );
  lines.push(
    `Avg function length: ${before.avgFunctionLength} -> ${after.avgFunctionLength} (${delta.avgFunctionLength})`
  );
  lines.push(
    `Duplicate blocks: ${before.duplicateBlocks} -> ${after.duplicateBlocks} (${delta.duplicateBlocks})`
  );
  lines.push(
    `Total functions: ${before.totalFunctions} -> ${after.totalFunctions} (${delta.totalFunctions})`
  );
  if (summary.note) {
    lines.push(summary.note);
  }
  return lines;
}

function formatApplyResult(result: FixApplyResult): string[] {
  const lines: string[] = ["", "Proof-Locked Apply"];
  lines.push(result.message);
  if (result.branch) {
    lines.push(`Branch: ${result.branch}`);
  }
  if (result.testCommand) {
    lines.push(`Tests: ${result.testCommand}`);
  }
  if (result.testsPassed !== undefined) {
    lines.push(`Tests passed: ${result.testsPassed ? "yes" : "no"}`);
  }
  return lines;
}

function formatArchitectureSummary(analysis?: AnalysisResult): string[] {
  if (!analysis?.dependencySummary) {
    return [];
  }
  const summary = analysis.dependencySummary;
  const lines: string[] = ["", "Architecture Map"];
  lines.push(`Internal modules: ${summary.nodes}`);
  lines.push(`Import links: ${summary.edges}`);
  if (summary.topImporters.length > 0) {
    lines.push("Top importers:");
    for (const entry of summary.topImporters) {
      lines.push(`- ${entry.file} (${entry.imports})`);
    }
  }
  if (summary.topImported.length > 0) {
    lines.push("Most imported:");
    for (const entry of summary.topImported) {
      lines.push(`- ${entry.file} (${entry.importedBy})`);
    }
  }
  if (summary.cycles > 0 && summary.sampleCycle) {
    lines.push(`Cycles detected: ${summary.cycles}`);
    lines.push(`Example cycle: ${summary.sampleCycle.from} ↔ ${summary.sampleCycle.to}`);
  } else {
    lines.push("Cycles detected: 0");
  }
  return lines;
}

export function runOutputFormatterAgent(
  config: CliConfig,
  roast: RoastResult,
  fixResult?: FixResult,
  analysis?: AnalysisResult
): FormattedOutput {
  const title = `CodeRoast (${config.severity}, ${config.focus})`;
  const divider = "-".repeat(title.length);

  const sections: string[] = [`${title}\n${divider}\n${roast.content}`];

  if (roast.actionItems && roast.actionItems.length > 0 && roast.usedGemini === false) {
    sections.push(["", "Action Items", ...roast.actionItems.map((item) => `- ${item}`)].join("\n"));
  }

  if (analysis?.dependencySummary) {
    sections.push(formatArchitectureSummary(analysis).join("\n").trimEnd());
  }

  if (fixResult?.previewSummary) {
    sections.push(formatPreviewSummary(fixResult.previewSummary).join("\n").trimEnd());
  }

  if (fixResult && fixResult.suggestions.length > 0) {
    const fixLines: string[] = ["", "Fix-It (preview)"];
    let hiddenPatch = false;
    for (const suggestion of fixResult.suggestions) {
      fixLines.push(formatFixSummary(suggestion));
      if (config.showDetails && suggestion.verificationDetails) {
        fixLines.push(`Details: ${suggestion.verificationDetails}`);
      }
      if (suggestion.debugPaths && suggestion.debugPaths.length > 0) {
        fixLines.push("Debug output:");
        for (const debugPath of suggestion.debugPaths) {
          fixLines.push(`- ${debugPath}`);
        }
      }
      if (config.showDetails && suggestion.patch) {
        fixLines.push(suggestion.patch);
      } else if (suggestion.patch) {
        hiddenPatch = true;
      }
      fixLines.push("");
    }
    if (hiddenPatch && !config.showDetails) {
      fixLines.push("Run with --details to see the patch diff.");
    }
    sections.push(fixLines.join("\n").trimEnd());
  }

  if (fixResult?.applyResult) {
    sections.push(formatApplyResult(fixResult.applyResult).join("\n").trimEnd());
  }

  return {
    text: `${sections.join("\n")}\n`,
  };
}
