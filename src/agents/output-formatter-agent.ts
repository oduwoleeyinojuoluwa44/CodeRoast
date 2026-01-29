import type { CliConfig, FixResult, FixSuggestion, FormattedOutput, RoastResult } from "../types";

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

export function runOutputFormatterAgent(
  config: CliConfig,
  roast: RoastResult,
  fixResult?: FixResult
): FormattedOutput {
  const title = `CodeRoast (${config.severity}, ${config.focus})`;
  const divider = "-".repeat(title.length);

  const sections: string[] = [`${title}\n${divider}\n${roast.content}`];

  if (fixResult && fixResult.suggestions.length > 0) {
    const fixLines: string[] = ["", "Fix-It (preview)"];
    let hiddenPatch = false;
    for (const suggestion of fixResult.suggestions) {
      fixLines.push(formatFixSummary(suggestion));
      if (config.showDetails && suggestion.verificationDetails) {
        fixLines.push(`Details: ${suggestion.verificationDetails}`);
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

  return {
    text: `${sections.join("\n")}\n`,
  };
}
