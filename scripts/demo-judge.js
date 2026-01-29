require("dotenv").config({ override: true });
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

function getArgValue(name) {
  const flag = `--${name}`;
  const prefix = `${flag}=`;
  const index = process.argv.indexOf(flag);
  if (index !== -1) {
    return process.argv[index + 1];
  }
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  return undefined;
}

function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const distIndex = path.join(projectRoot, "dist", "index.js");
  if (!fs.existsSync(distIndex)) {
    execSync("npm run build", { cwd: projectRoot, stdio: "inherit" });
  }

  const args = [
    "--path",
    ".",
    "--severity",
    "savage",
    "--focus",
    "architecture",
    "--fix",
    "--details",
  ];

  if (process.argv.includes("--apply")) {
    args.push("--apply-fixes");
    const testCmd = getArgValue("test-cmd");
    if (testCmd) {
      args.push(`--fix-test-cmd=${testCmd}`);
    }
  }

  execSync(`node "${distIndex}" ${args.join(" ")}`, {
    cwd: projectRoot,
    stdio: "inherit",
    env: process.env,
  });
}

main();
