import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import type { CliConfig, FixApplyResult, FixResult } from "../types";

function runGit(command: string, cwd: string): string {
  return execSync(`git ${command}`, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    .toString()
    .trim();
}

function getRepoRoot(rootPath: string): string {
  return runGit("rev-parse --show-toplevel", rootPath);
}

function isWorkingTreeClean(rootPath: string): boolean {
  const status = runGit("status --porcelain", rootPath);
  return status.length === 0;
}

function getCurrentBranch(rootPath: string): string {
  return runGit("rev-parse --abbrev-ref HEAD", rootPath);
}

function branchExists(rootPath: string, name: string): boolean {
  const result = runGit(`branch --list ${name}`, rootPath);
  return result.length > 0;
}

function buildBranchName(rootPath: string, requested?: string): string {
  const base =
    requested?.trim() ||
    `coderoast-fix-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
  if (!branchExists(rootPath, base)) {
    return base;
  }
  let counter = 1;
  while (branchExists(rootPath, `${base}-${counter}`)) {
    counter += 1;
  }
  return `${base}-${counter}`;
}

async function writeTempPatch(contents: string): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "coderoast-patch-"));
  const patchPath = path.join(tempDir, "fix.patch");
  await fs.writeFile(patchPath, contents);
  return patchPath;
}

export async function runFixApplyAgent(
  config: CliConfig,
  fixResult: FixResult
): Promise<FixApplyResult> {
  const rootPath = path.resolve(config.path);

  const patches = fixResult.suggestions
    .filter((suggestion) => suggestion.verified && suggestion.patch)
    .map((suggestion) => suggestion.patch.trim())
    .filter((patch) => patch.length > 0);

  if (patches.length === 0) {
    return {
      status: "skipped",
      message: "Apply skipped: no verified patches to apply.",
    };
  }

  let repoRoot = "";
  try {
    repoRoot = getRepoRoot(rootPath);
  } catch {
    return {
      status: "failed",
      message: "Apply failed: not inside a git repository.",
    };
  }

  if (!isWorkingTreeClean(repoRoot)) {
    return {
      status: "failed",
      message: "Apply failed: working tree is not clean. Commit or stash changes first.",
    };
  }

  const branch = buildBranchName(repoRoot, config.fixBranch);
  const currentBranch = getCurrentBranch(repoRoot);

  try {
    runGit(`checkout -b ${branch}`, repoRoot);
  } catch {
    return {
      status: "failed",
      message: `Apply failed: could not create branch ${branch}.`,
      branch,
    };
  }

  let patchPath = "";
  try {
    patchPath = await writeTempPatch(patches.join("\n\n") + "\n");
    execSync(`git apply --whitespace=nowarn "${patchPath}"`, {
      cwd: repoRoot,
      stdio: "inherit",
    });
  } catch {
    try {
      runGit(`checkout ${currentBranch}`, repoRoot);
      runGit(`branch -D ${branch}`, repoRoot);
    } catch {
      // ignore rollback errors
    }
    return {
      status: "failed",
      message: "Apply failed: patch could not be applied cleanly.",
      branch,
    };
  }

  const testCommand = config.fixTestCmd ?? "npm test";
  let testsPassed = true;
  try {
    execSync(testCommand, { cwd: repoRoot, stdio: "inherit" });
  } catch {
    testsPassed = false;
  }

  if (!testsPassed) {
    return {
      status: "failed",
      message: "Apply failed: tests did not pass.",
      branch,
      testCommand,
      testsPassed,
    };
  }

  return {
    status: "applied",
    message: "Apply succeeded: patch applied on a new branch with passing tests.",
    branch,
    testCommand,
    testsPassed,
  };
}
