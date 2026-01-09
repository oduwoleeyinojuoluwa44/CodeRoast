import type { CliConfig, FormattedOutput, RoastResult } from "../types";

export function runOutputFormatterAgent(
  config: CliConfig,
  roast: RoastResult
): FormattedOutput {
  const title = `CodeRoast (${config.severity}, ${config.focus})`;
  const divider = "-".repeat(title.length);

  return {
    text: `${title}\n${divider}\n${roast.content}\n`,
  };
}
