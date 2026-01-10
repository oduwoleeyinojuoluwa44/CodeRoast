import fs from "node:fs";
import path from "node:path";
import ignore from "ignore";
import type { CliConfig, RepoScanResult } from "../types";

const DEFAULT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_BINARY_CHECK_BYTES = 8000;
const MAX_IGNORED_PATHS = 50;
const NO_EXTENSION_KEY = "<none>";

const AUTO_IGNORE_DIRS = [".git", "node_modules", "dist", "build", ".next", "out", ".turbo"];
const PROJECT_FILE_NAMES = new Set([
  "package.json",
  "tsconfig.json",
  "requirements.txt",
  "pyproject.toml",
  "go.mod",
]);
const ENTRY_ROOT_BASE_NAMES = new Set(["app", "server"]);
const ENTRY_SRC_BASE_NAMES = new Set(["index", "main"]);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "ts",
  ".tsx": "ts",
  ".js": "js",
  ".jsx": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".json": "json",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".py": "py",
  ".go": "go",
  ".rs": "rs",
  ".java": "java",
  ".kt": "kt",
  ".cs": "cs",
  ".rb": "rb",
  ".php": "php",
  ".swift": "swift",
  ".scala": "scala",
  ".sh": "shell",
  ".ps1": "powershell",
  ".html": "html",
  ".css": "css",
  ".scss": "scss",
  ".sass": "sass",
  ".less": "less",
  ".sql": "sql",
};

const TEXT_EXTENSIONS = new Set([
  ...Object.keys(LANGUAGE_BY_EXTENSION),
  ".md",
  ".mdx",
  ".txt",
  ".ini",
  ".env",
  ".xml",
  ".csv",
  ".tsv",
  ".graphql",
  ".gql",
  ".vue",
  ".svelte",
  ".astro",
  ".lock",
]);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".tiff",
  ".psd",
  ".ai",
  ".sketch",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".7z",
  ".rar",
  ".pdf",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".class",
  ".jar",
  ".war",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".bin",
  ".dat",
]);

type IgnoreMatcher = (relativePath: string, isDir: boolean) => boolean;

type ScanState = {
  languages: Record<string, number>;
  fileTypes: Record<string, number>;
  totalFiles: number;
  totalFolders: number;
  entryPoints: Set<string>;
  projectFiles: Set<string>;
  ignoredCount: number;
  ignoredPaths: Set<string>;
  repoSizeBytes: number;
  warnings: string[];
};

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function normalizeRelativePath(value: string): string {
  const normalized = toPosixPath(path.normalize(value));
  return normalized.replace(/^\.\/+/, "");
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function isBinaryExtension(extension: string): boolean {
  return BINARY_EXTENSIONS.has(extension);
}

function shouldCheckBinary(extension: string): boolean {
  if (!extension) {
    return true;
  }
  return !TEXT_EXTENSIONS.has(extension);
}

async function isBinaryFile(filePath: string, size: number): Promise<boolean> {
  const bytesToRead = Math.min(size, MAX_BINARY_CHECK_BYTES);
  if (bytesToRead === 0) {
    return false;
  }

  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(filePath, "r");
    const buffer = Buffer.alloc(bytesToRead);
    await handle.read(buffer, 0, bytesToRead, 0);
    return buffer.includes(0);
  } catch {
    return true;
  } finally {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
  }
}

async function readGitignore(rootPath: string): Promise<string[]> {
  try {
    const content = await fs.promises.readFile(path.join(rootPath, ".gitignore"), "utf8");
    return content.split(/\r?\n/);
  } catch {
    return [];
  }
}

async function createIgnoreMatcher(rootPath: string): Promise<IgnoreMatcher> {
  const matcher = ignore();
  const gitignoreLines = await readGitignore(rootPath);
  if (gitignoreLines.length > 0) {
    matcher.add(gitignoreLines);
  }

  matcher.add(AUTO_IGNORE_DIRS.map((dir) => `${dir}/`));

  return (relativePath: string, isDir: boolean): boolean => {
    if (!relativePath) {
      return false;
    }
    const target = isDir ? `${relativePath}/` : relativePath;
    return matcher.ignores(target);
  };
}

function isWithinRoot(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  if (!relative) {
    return false;
  }
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function safeStat(filePath: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.stat(filePath);
  } catch {
    return null;
  }
}

function isEntryPointPath(relativePath: string): boolean {
  const normalized = relativePath;
  const parts = normalized.split("/");
  const extension = path.posix.extname(normalized);
  const baseName = path.posix.basename(normalized, extension);

  if (parts.length === 2 && parts[0] === "src" && ENTRY_SRC_BASE_NAMES.has(baseName)) {
    return true;
  }

  if (parts.length === 1 && ENTRY_ROOT_BASE_NAMES.has(baseName)) {
    return true;
  }

  return false;
}

async function resolvePackageEntryPoints(
  rootPath: string,
  maxFileSizeBytes: number,
  shouldIgnore: IgnoreMatcher
): Promise<string[]> {
  const packageRelativePath = "package.json";
  if (shouldIgnore(packageRelativePath, false)) {
    return [];
  }

  const packagePath = path.join(rootPath, packageRelativePath);
  const stats = await safeStat(packagePath);
  if (!stats || !stats.isFile()) {
    return [];
  }
  if (stats.size > maxFileSizeBytes) {
    return [];
  }

  let packageJson: unknown;
  try {
    const content = await fs.promises.readFile(packagePath, "utf8");
    packageJson = JSON.parse(content);
  } catch {
    return [];
  }

  const entries: string[] = [];
  if (packageJson && typeof packageJson === "object") {
    const data = packageJson as Record<string, unknown>;
    if (typeof data.main === "string") {
      entries.push(data.main);
    }
    if (typeof data.bin === "string") {
      entries.push(data.bin);
    } else if (data.bin && typeof data.bin === "object") {
      for (const value of Object.values(data.bin)) {
        if (typeof value === "string") {
          entries.push(value);
        }
      }
    }
  }

  const entryPoints: string[] = [];
  for (const entry of entries) {
    const normalized = normalizeRelativePath(entry);
    if (!normalized) {
      continue;
    }
    const absolute = path.resolve(rootPath, normalized);
    if (!isWithinRoot(rootPath, absolute)) {
      continue;
    }
    const entryStats = await safeStat(absolute);
    if (!entryStats || !entryStats.isFile()) {
      continue;
    }
    entryPoints.push(toPosixPath(path.relative(rootPath, absolute)));
  }

  return entryPoints;
}

function toSortedRecord(record: Record<string, number>): Record<string, number> {
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = record[key];
  }
  return sorted;
}

function bytesToMB(bytes: number): number {
  if (bytes === 0) {
    return 0;
  }
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

function getMaxFileSizeBytes(config: CliConfig): number {
  if (!config.maxFileSizeMB || config.maxFileSizeMB <= 0) {
    return DEFAULT_MAX_FILE_SIZE_BYTES;
  }
  return config.maxFileSizeMB * 1024 * 1024;
}

export async function runRepoScannerAgent(config: CliConfig): Promise<RepoScanResult> {
  const rootPath = path.resolve(config.path);
  const maxFileSizeBytes = getMaxFileSizeBytes(config);
  const shouldIgnore = await createIgnoreMatcher(rootPath);
  const deadline =
    typeof config.scanTimeoutMs === "number" && config.scanTimeoutMs > 0
      ? Date.now() + config.scanTimeoutMs
      : null;
  const scanState: ScanState = {
    languages: {},
    fileTypes: {},
    totalFiles: 0,
    totalFolders: 0,
    entryPoints: new Set<string>(),
    projectFiles: new Set<string>(),
    ignoredCount: 0,
    ignoredPaths: new Set<string>(),
    repoSizeBytes: 0,
    warnings: [],
  };

  const pending: string[] = [rootPath];
  let timedOut = false;

  while (pending.length > 0) {
    if (deadline && Date.now() > deadline) {
      timedOut = true;
      break;
    }

    const currentPath = pending.pop();
    if (!currentPath) {
      continue;
    }

    let directory: fs.Dir | null = null;
    try {
      directory = await fs.promises.opendir(currentPath);
    } catch {
      scanState.warnings.push(`Unable to read directory: ${currentPath}`);
      continue;
    }

    scanState.totalFolders += 1;

    for await (const entry of directory) {
      if (deadline && Date.now() > deadline) {
        timedOut = true;
        break;
      }

      if (entry.isSymbolicLink()) {
        continue;
      }

      const fullPath = path.join(currentPath, entry.name);
      const relativePath = toPosixPath(path.relative(rootPath, fullPath));
      const isDir = entry.isDirectory();

      if (shouldIgnore(relativePath, isDir)) {
        scanState.ignoredCount += 1;
        if (isDir && scanState.ignoredPaths.size < MAX_IGNORED_PATHS) {
          scanState.ignoredPaths.add(relativePath);
        }
        continue;
      }

      if (isDir) {
        pending.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const stats = await safeStat(fullPath);
      if (!stats || !stats.isFile()) {
        scanState.warnings.push(`Unable to stat file: ${fullPath}`);
        continue;
      }

      scanState.repoSizeBytes += stats.size;

      if (PROJECT_FILE_NAMES.has(entry.name)) {
        scanState.projectFiles.add(relativePath);
      }

      if (isEntryPointPath(relativePath)) {
        scanState.entryPoints.add(relativePath);
      }

      if (stats.size > maxFileSizeBytes) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (isBinaryExtension(extension)) {
        continue;
      }

      if (shouldCheckBinary(extension)) {
        const binary = await isBinaryFile(fullPath, stats.size);
        if (binary) {
          continue;
        }
      }

      scanState.totalFiles += 1;
      increment(scanState.fileTypes, extension || NO_EXTENSION_KEY);
      const language = LANGUAGE_BY_EXTENSION[extension] ?? "other";
      increment(scanState.languages, language);
    }

    if (timedOut) {
      break;
    }
  }

  const packageEntryPoints = await resolvePackageEntryPoints(
    rootPath,
    maxFileSizeBytes,
    shouldIgnore
  );
  for (const entryPoint of packageEntryPoints) {
    scanState.entryPoints.add(entryPoint);
  }

  if (timedOut) {
    scanState.warnings.push("Scan timed out");
  }

  const result: RepoScanResult = {
    languages: toSortedRecord(scanState.languages),
    fileTypes: toSortedRecord(scanState.fileTypes),
    totalFiles: scanState.totalFiles,
    totalFolders: scanState.totalFolders,
    entryPoints: Array.from(scanState.entryPoints).sort(),
    projectFiles: Array.from(scanState.projectFiles).sort(),
    ignoredCount: scanState.ignoredCount,
    repoSizeMB: bytesToMB(scanState.repoSizeBytes),
  };

  if (scanState.ignoredPaths.size > 0) {
    result.ignoredPaths = Array.from(scanState.ignoredPaths).sort();
  }

  return result;
}
