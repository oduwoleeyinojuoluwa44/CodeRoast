import type { CliConfig, FixResult, FormattedOutput, RoastResult } from "../types";

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
    for (const suggestion of fixResult.suggestions) {
      const status = suggestion.verified ? "verified" : "rejected";
      fixLines.push(
        `${suggestion.issueId}. [${suggestion.issueType}] ${status} - ${suggestion.verificationMessage}`
      );
      if (suggestion.verificationDetails) {
        fixLines.push(`Details: ${suggestion.verificationDetails}`);
      }
      if (suggestion.patch) {
        fixLines.push(suggestion.patch);
      }
      fixLines.push("");
    }
    sections.push(fixLines.join("\n").trimEnd());
  }

  return {
    text: `${sections.join("\n")}\n`,
  };
}
