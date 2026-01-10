import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type {
  AnalysisResult,
  CircularDependency,
  CliConfig,
  DuplicateBlock,
  LongFunction,
  RepoScanResult,
} from "../types";

export const LONG_FUNCTION_LOC = 50;
export const DUPLICATE_MIN_LINES = 10;
export const DUPLICATE_MAX_LINES = 50;
export const DUPLICATE_MIN_OCCURRENCES = 2;

const JS_TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const TEST_DIR_NAMES = new Set(["__tests__", "test", "tests"]);

type NormalizedFile = {
  path: string;
  extension: string;
  normalizedLines: string[];
  lineNumbers: number[];
  imports: string[];
};

type DuplicateCandidate = {
  file: string;
  startIndex: number;
};

function getScriptKind(extension: string): ts.ScriptKind {
  switch (extension) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
      return ts.ScriptKind.JS;
    case ".mjs":
      return ts.ScriptKind.JS;
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function normalizeContent(content: string): { normalizedLines: string[]; lineNumbers: number[] } {
  const withoutBlockComments = content.replace(/\/\*[\s\S]*?\*\//g, (match) => {
    return match.replace(/[^\n]/g, "");
  });
  const withoutLineComments = withoutBlockComments.replace(/\/\/.*$/gm, "");
  const rawLines = withoutLineComments.split(/\r?\n/);

  const normalizedLines: string[] = [];
  const lineNumbers: number[] = [];
  for (let i = 0; i < rawLines.length; i += 1) {
    const normalized = rawLines[i].replace(/\s+/g, " ").trim();
    if (normalized.length === 0) {
      continue;
    }
    normalizedLines.push(normalized);
    lineNumbers.push(i + 1);
  }

  return { normalizedLines, lineNumbers };
}

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

function isTestPath(relativePath: string): boolean {
  const segments = relativePath.split("/");
  if (segments.some((segment) => TEST_DIR_NAMES.has(segment))) {
    return true;
  }
  const fileName = path.posix.basename(relativePath);
  return /\.(spec|test)\.[jt]sx?$/.test(fileName);
}

function toAbsolutePath(rootPath: string, relativePath: string): string {
  const parts = relativePath.split("/");
  return path.resolve(rootPath, path.join(...parts));
}

function collectImports(sourceFile: ts.SourceFile): string[] {
  const imports: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference;
      if (ts.isExternalModuleReference(ref) && ref.expression && ts.isStringLiteral(ref.expression)) {
        imports.push(ref.expression.text);
      }
    } else if (ts.isCallExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require" &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        imports.push(node.arguments[0].text);
      } else if (node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1) {
        const arg = node.arguments[0];
        if (ts.isStringLiteral(arg)) {
          imports.push(arg.text);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return imports;
}

function getFunctionName(node: ts.Node, sourceFile: ts.SourceFile): string {
  if (ts.isFunctionDeclaration(node) && node.name) {
    return node.name.text;
  }
  if (
    (ts.isMethodDeclaration(node) ||
      ts.isMethodSignature(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)) &&
    node.name
  ) {
    return node.name.getText(sourceFile);
  }
  if (ts.isConstructorDeclaration(node)) {
    return "constructor";
  }

  const parent = node.parent;
  if (parent) {
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      return parent.name.text;
    }
    if (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) {
      if (ts.isIdentifier(parent.name)) {
        return parent.name.text;
      }
      return parent.name.getText(sourceFile);
    }
  }

  return "<anonymous>";
}

function collectFunctionLengths(sourceFile: ts.SourceFile, filePath: string): LongFunction[] {
  const functions: LongFunction[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && "body" in node && node.body) {
      const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
      const length = end.line - start.line + 1;

      functions.push({
        file: filePath,
        name: getFunctionName(node, sourceFile),
        length,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return functions;
}

function resolveImportPath(
  importerPath: string,
  specifier: string,
  filePaths: Set<string>
): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const baseDir = path.posix.dirname(importerPath);
  const combined = path.posix.normalize(path.posix.join(baseDir, specifier));
  const hasExtension = path.posix.extname(combined) !== "";

  const candidates: string[] = [];
  if (hasExtension) {
    candidates.push(combined);
  } else {
    for (const extension of JS_TS_EXTENSIONS) {
      candidates.push(`${combined}${extension}`);
      candidates.push(path.posix.join(combined, `index${extension}`));
    }
  }

  for (const candidate of candidates) {
    if (filePaths.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

function collectDuplicateBlocks(files: NormalizedFile[]): DuplicateBlock[] {
  const candidates = new Map<string, DuplicateCandidate[]>();
  const fileIndex = new Map<string, NormalizedFile>();

  for (const file of files) {
    fileIndex.set(file.path, file);
    const totalLines = file.normalizedLines.length;
    if (totalLines < DUPLICATE_MIN_LINES) {
      continue;
    }

    for (let start = 0; start <= totalLines - DUPLICATE_MIN_LINES; start += 1) {
      const blockLines = file.normalizedLines.slice(start, start + DUPLICATE_MIN_LINES);
      const blockKey = blockLines.join("\n");
      const group = candidates.get(blockKey);
      if (group) {
        group.push({ file: file.path, startIndex: start });
      } else {
        candidates.set(blockKey, [{ file: file.path, startIndex: start }]);
      }
    }
  }

  const duplicatesMap = new Map<string, { block: DuplicateBlock; occurrenceKeys: Set<string> }>();

  for (const [blockKey, occurrences] of candidates) {
    if (occurrences.length < DUPLICATE_MIN_OCCURRENCES) {
      continue;
    }

    const baseline = occurrences[0];
    const baselineFile = fileIndex.get(baseline.file);
    if (!baselineFile) {
      continue;
    }

    let length = DUPLICATE_MIN_LINES;
    for (let offset = DUPLICATE_MIN_LINES; offset < DUPLICATE_MAX_LINES; offset += 1) {
      const baselineIndex = baseline.startIndex + offset;
      if (baselineIndex >= baselineFile.normalizedLines.length) {
        break;
      }

      const expected = baselineFile.normalizedLines[baselineIndex];
      let allMatch = true;
      for (const occurrence of occurrences) {
        const file = fileIndex.get(occurrence.file);
        if (!file || occurrence.startIndex + offset >= file.normalizedLines.length) {
          allMatch = false;
          break;
        }
        if (file.normalizedLines[occurrence.startIndex + offset] !== expected) {
          allMatch = false;
          break;
        }
      }
      if (!allMatch) {
        break;
      }
      length += 1;
    }

    const extendedBlockLines = baselineFile.normalizedLines.slice(
      baseline.startIndex,
      baseline.startIndex + length
    );
    const extendedKey = extendedBlockLines.join("\n");
    const hash = hashString(extendedKey);

    let entry = duplicatesMap.get(extendedKey);
    if (!entry) {
      entry = {
        block: {
          hash,
          length,
          occurrences: [],
        },
        occurrenceKeys: new Set<string>(),
      };
      duplicatesMap.set(extendedKey, entry);
    }

    for (const occurrence of occurrences) {
      const file = fileIndex.get(occurrence.file);
      if (!file) {
        continue;
      }
      const startLine = file.lineNumbers[occurrence.startIndex];
      const endIndex = occurrence.startIndex + length - 1;
      if (startLine === undefined || endIndex >= file.lineNumbers.length) {
        continue;
      }
      const endLine = file.lineNumbers[endIndex];
      const occurrenceKey = `${occurrence.file}:${startLine}:${endLine}`;
      if (entry.occurrenceKeys.has(occurrenceKey)) {
        continue;
      }
      entry.occurrenceKeys.add(occurrenceKey);
      entry.block.occurrences.push({
        file: occurrence.file,
        startLine,
        endLine,
      });
    }
  }

  const blocks: DuplicateBlock[] = [];
  for (const entry of duplicatesMap.values()) {
    if (entry.block.occurrences.length >= DUPLICATE_MIN_OCCURRENCES) {
      blocks.push(entry.block);
    }
  }

  return blocks;
}

function collectCircularDependencies(
  files: NormalizedFile[],
  filePaths: Set<string>
): CircularDependency[] {
  const graph = new Map<string, Set<string>>();

  for (const file of files) {
    const edges = graph.get(file.path) ?? new Set<string>();
    for (const specifier of file.imports) {
      const resolved = resolveImportPath(file.path, specifier, filePaths);
      if (resolved) {
        edges.add(resolved);
      }
    }
    graph.set(file.path, edges);
  }

  const cycles: CircularDependency[] = [];
  const seen = new Set<string>();
  for (const [from, targets] of graph) {
    for (const to of targets) {
      if (graph.get(to)?.has(from)) {
        const key = [from, to].sort().join("::");
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        cycles.push({ from, to });
      }
    }
  }

  return cycles;
}

export async function runCodeAnalysisAgent(
  config: CliConfig,
  scan: RepoScanResult
): Promise<AnalysisResult> {
  const rootPath = path.resolve(config.path);
  const files = scan.files.filter((file) => JS_TS_EXTENSIONS.has(file.extension));

  const normalizedFiles: NormalizedFile[] = [];
  const allFunctions: LongFunction[] = [];
  const testFiles: string[] = [];

  for (const file of files) {
    const relativePath = file.path;
    if (isTestPath(relativePath)) {
      testFiles.push(relativePath);
    }

    const absolutePath = toAbsolutePath(rootPath, relativePath);
    let content: string;
    try {
      content = await fs.readFile(absolutePath, "utf8");
    } catch {
      continue;
    }

    const scriptKind = getScriptKind(file.extension);
    const sourceFile = ts.createSourceFile(
      relativePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      scriptKind
    );

    allFunctions.push(...collectFunctionLengths(sourceFile, relativePath));

    const { normalizedLines, lineNumbers } = normalizeContent(content);
    normalizedFiles.push({
      path: relativePath,
      extension: file.extension,
      normalizedLines,
      lineNumbers,
      imports: collectImports(sourceFile),
    });
  }

  const totalFunctions = allFunctions.length;
  const maxFunctionLength = totalFunctions
    ? Math.max(...allFunctions.map((fn) => fn.length))
    : 0;
  const avgFunctionLength = totalFunctions
    ? Math.round(
        (allFunctions.reduce((sum, fn) => sum + fn.length, 0) / totalFunctions) * 100
      ) / 100
    : 0;

  const longFunctions = allFunctions.filter((fn) => fn.length >= LONG_FUNCTION_LOC);
  const duplicateBlocks = collectDuplicateBlocks(normalizedFiles);
  const filePathSet = new Set<string>(normalizedFiles.map((file) => file.path));
  const circularDependencies = collectCircularDependencies(normalizedFiles, filePathSet);

  return {
    metrics: {
      maxFunctionLength,
      avgFunctionLength,
      duplicateBlocks: duplicateBlocks.length,
      totalFunctions,
    },
    signals: {
      longFunctions,
      duplicateBlocks,
      circularDependencies,
      testPresence: {
        hasTests: testFiles.length > 0,
        testFiles: testFiles.sort(),
      },
    },
  };
}
