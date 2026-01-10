export type Severity = "gentle" | "savage" | "investor-demo";
export type Focus = "architecture" | "performance" | "style" | "security" | "general";

export interface CliConfig {
  path: string;
  severity: Severity;
  focus: Focus;
  maxFileSizeMB?: number;
  scanTimeoutMs?: number;
}

export interface FileManifestEntry {
  path: string;
  sizeBytes: number;
  extension: string;
  language?: string;
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
  files: FileManifestEntry[];
}

export interface LongFunction {
  file: string;
  name: string;
  length: number;
}

export interface DuplicateOccurrence {
  file: string;
  startLine: number;
  endLine: number;
}

export interface DuplicateBlock {
  hash: string;
  length: number;
  occurrences: DuplicateOccurrence[];
}

export interface CircularDependency {
  from: string;
  to: string;
}

export interface TestPresence {
  hasTests: boolean;
  testFiles: string[];
}

export interface AnalysisMetrics {
  maxFunctionLength: number;
  avgFunctionLength: number;
  duplicateBlocks: number;
  totalFunctions: number;
}

export interface AnalysisSignals {
  longFunctions: LongFunction[];
  duplicateBlocks: DuplicateBlock[];
  circularDependencies: CircularDependency[];
  testPresence: TestPresence;
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
