import { runCliAgent } from "./agents/cli-agent";
import { runCodeAnalysisAgent } from "./agents/code-analysis-agent";
import { runInsightAggregatorAgent } from "./agents/insight-aggregator-agent";
import { runOutputFormatterAgent } from "./agents/output-formatter-agent";
import { runRepoScannerAgent } from "./agents/repo-scanner-agent";
import { runRoastNarratorAgent } from "./agents/roast-narrator-agent";

export async function runPipeline(argv: string[]): Promise<string> {
  const cliConfig = runCliAgent(argv);
  const scanResult = await runRepoScannerAgent(cliConfig);
  const analysisResult = runCodeAnalysisAgent(cliConfig, scanResult);
  const insights = runInsightAggregatorAgent(scanResult, analysisResult);
  const roast = runRoastNarratorAgent(cliConfig, insights);
  const formatted = runOutputFormatterAgent(cliConfig, roast);

  return formatted.text;
}
