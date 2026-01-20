import { runCliAgent } from "./agents/cli-agent";
import { runCodeAnalysisAgent } from "./agents/code-analysis-agent";
import { runEvidenceGuardAgent } from "./agents/evidence-guard-agent";
import { runFixItAgent } from "./agents/fix-it-agent";
import { runInsightAggregatorAgent } from "./agents/insight-aggregator-agent";
import { runOutputFormatterAgent } from "./agents/output-formatter-agent";
import { runRepoScannerAgent } from "./agents/repo-scanner-agent";
import { runRoastNarratorAgent } from "./agents/roast-narrator-agent";

export async function runPipeline(argv: string[]): Promise<string> {
  const cliConfig = runCliAgent(argv);
  const scanResult = await runRepoScannerAgent(cliConfig);
  const analysisResult = await runCodeAnalysisAgent(cliConfig, scanResult);
  const insights = runInsightAggregatorAgent(scanResult, analysisResult);
  const guardedInsights = runEvidenceGuardAgent(insights);
  const fixResult = cliConfig.enableFixes
    ? await runFixItAgent(cliConfig, scanResult, analysisResult, guardedInsights)
    : undefined;
  const roast = await runRoastNarratorAgent(cliConfig, guardedInsights);
  const formatted = runOutputFormatterAgent(cliConfig, roast, fixResult);
  return formatted.text;
}
