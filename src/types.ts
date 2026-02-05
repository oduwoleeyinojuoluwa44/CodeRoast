export type Severity = "gentle" | "savage" | "investor-demo";
export type Focus = "architecture" | "performance" | "style" | "security" | "general";

export interface CliConfig {
  path: string;
  severity: Severity;
  focus: Focus;
  maxFileSizeMB?: number;
  scanTimeoutMs?: number;
  enableFixes?: boolean;
  showDetails?: boolean;
  detailsLimit?: number;
  applyFixes?: boolean;
  fixBranch?: string;
  fixTestCmd?: string;
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
  startLine: number;
  endLine: number;
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
  fromStartLine: number;
  fromEndLine: number;
  toStartLine: number;
  toEndLine: number;
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
  dependencySummary?: DependencySummary;
}

export interface DependencySummary {
  nodes: number;
  edges: number;
  topImporters: { file: string; imports: number }[];
  topImported: { file: string; importedBy: number }[];
  cycles: number;
  sampleCycle?: { from: string; to: string };
}

export type Confidence = "low" | "medium" | "high";

export type EvidenceMetricType = "loc" | "count" | "hash";

export interface EvidenceMetric {
  type: EvidenceMetricType;
  value: number | string;
}

export interface EvidenceItem {
  file: string;
  startLine: number;
  endLine: number;
  metrics: EvidenceMetric[];
}

export interface Issue {
  type: string;
  signal: string;
  confidence: Confidence;
  evidence: EvidenceItem[];
}

export interface AggregatedInsights {
  issues: Issue[];
}

export interface GuardedIssue extends Issue {
  evidenceComplete: boolean;
  missingEvidenceReason?: string;
}

export interface GuardedInsights {
  issues: GuardedIssue[];
}

export interface RoastResult {
  content: string;
  usedGemini?: boolean;
  actionItems?: string[];
}

export interface FixSuggestion {
  issueId: number;
  issueType: string;
  signal: string;
  files: string[];
  patch: string;
  verified: boolean;
  verificationMessage: string;
  verificationDetails?: string;
}

export interface FixResult {
  suggestions: FixSuggestion[];
  previewSummary?: FixPreviewSummary;
  applyResult?: FixApplyResult;
}

export interface FixPreviewSummary {
  before: AnalysisMetrics;
  after?: AnalysisMetrics;
  delta?: MetricDelta;
  note?: string;
}

export interface FixApplyResult {
  status: "skipped" | "applied" | "failed";
  branch?: string;
  message: string;
  testCommand?: string;
  testsPassed?: boolean;
}

export interface MetricDelta {
  maxFunctionLength: number;
  avgFunctionLength: number;
  duplicateBlocks: number;
  totalFunctions: number;
}

export interface FormattedOutput {
  text: string;
}
