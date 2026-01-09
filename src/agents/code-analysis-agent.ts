import type { AnalysisResult, CliConfig, RepoScanResult } from "../types";

export function runCodeAnalysisAgent(
  _config: CliConfig,
  _scan: RepoScanResult
): AnalysisResult {
  return {
    metrics: {
      maxFunctionLength: 0,
      avgFunctionLength: 0,
      duplicateBlocks: 0,
    },
    signals: {
      businessLogicInControllers: false,
      circularDependencies: false,
      testCoverage: "unknown",
    },
  };
}
