export type Severity = "gentle" | "savage" | "investor-demo";
export type Focus = "architecture" | "performance" | "style" | "security" | "general";

export interface CliConfig {
  path: string;
  severity: Severity;
  focus: Focus;
  maxFileSizeMB?: number;
  scanTimeoutMs?: number;
}

export interface RepoScanResult {
  languages: Record<string, number>;
  fileTypes: Record<string, number>;
  totalFiles: number;
  totalFolders: number;
  entryPoints: string[];
  projectFiles: string[];
  ignoredCount: number;
  repoSizeMB?: number;
  ignoredPaths?: string[];
}

export interface AnalysisMetrics {
  maxFunctionLength: number;
  avgFunctionLength: number;
  duplicateBlocks: number;
}

export type TestCoverage = "unknown" | "low" | "medium" | "high";

export interface AnalysisSignals {
  businessLogicInControllers: boolean;
  circularDependencies: boolean;
  testCoverage: TestCoverage;
}

export interface AnalysisResult {
  metrics: AnalysisMetrics;
  signals: AnalysisSignals;
}

export type Confidence = "low" | "medium" | "high";

export interface Issue {
  type: string;
  signal: string;
  confidence: Confidence;
  evidence: string;
}

export interface AggregatedInsights {
  issues: Issue[];
}

export interface RoastResult {
  content: string;
}

export interface FormattedOutput {
  text: string;
}
