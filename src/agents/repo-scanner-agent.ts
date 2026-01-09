import fs from "node:fs";
import path from "node:path";
import type { CliConfig, RepoScanResult } from "../types";

const DEFAULT_IGNORES = new Set(["node_modules", ".git", "dist", "build", "coverage"]);
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ".ts": "ts",
  ".tsx": "ts",
  ".js": "js",
  ".jsx": "js",
  ".mjs": "js",
  ".cjs": "js",
};

type ScanState = {
  fileCount: number;
  folderCount: number;
  languages: Set<string>;
};

function scanDirectory(currentPath: string, state: ScanState): void {
  state.folderCount += 1;

  const entries = fs.readdirSync(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    const fullPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      if (DEFAULT_IGNORES.has(entry.name)) {
        continue;
      }
      scanDirectory(fullPath, state);
      continue;
    }

    if (entry.isFile()) {
      state.fileCount += 1;
      const extension = path.extname(entry.name).toLowerCase();
      const language = EXTENSION_TO_LANGUAGE[extension];
      if (language) {
        state.languages.add(language);
      }
    }
  }
}

function detectEntryPoints(rootPath: string): string[] {
  const entryPoints: string[] = [];
  const candidates = ["src/index.ts", "src/index.js"];

  for (const candidate of candidates) {
    const fullPath = path.join(rootPath, candidate);
    if (fs.existsSync(fullPath)) {
      entryPoints.push(candidate);
    }
  }

  return entryPoints;
}

export function runRepoScannerAgent(config: CliConfig): RepoScanResult {
  const rootPath = path.resolve(config.path);
  const state: ScanState = {
    fileCount: 0,
    folderCount: 0,
    languages: new Set<string>(),
  };

  scanDirectory(rootPath, state);

  return {
    languages: Array.from(state.languages).sort(),
    fileCount: state.fileCount,
    folders: state.folderCount,
    entryPoints: detectEntryPoints(rootPath),
  };
}
