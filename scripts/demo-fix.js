require("dotenv").config({ override: true });
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");

async function writeFile(filePath, contents) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, contents);
}

async function createDemoRepo(root) {
  const duplicateBlock = Array.from({ length: 10 }, (_, i) => `const dup${i} = ${i};`).join(
    "\n"
  );
  const longLines = Array.from({ length: 55 }, (_, i) => `  const line${i} = ${i};`).join("\n");

  await writeFile(
    path.join(root, "src/dup-a.ts"),
    `export function alpha() {\n${duplicateBlock}\n}\n`
  );
  await writeFile(
    path.join(root, "src/dup-b.ts"),
    `export function beta() {\n${duplicateBlock}\n}\n`
  );
  await writeFile(
    path.join(root, "src/long.ts"),
    `export function longFn() {\n${longLines}\n}\n`
  );
}

async function main() {
  const keep = process.argv.includes("--keep");
  const model = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
  const apiVersion = process.env.GEMINI_API_VERSION;
  if (!process.env.GEMINI_API_KEY) {
    console.warn("GEMINI_API_KEY is not set; fix-it suggestions will be skipped.");
  } else {
    console.log(`Using GEMINI_MODEL=${model}`);
    if (apiVersion) {
      console.log(`Using GEMINI_API_VERSION=${apiVersion}`);
    }
  }

  const projectRoot = path.resolve(__dirname, "..");
  const distIndex = path.join(projectRoot, "dist", "index.js");
  if (!fs.existsSync(distIndex)) {
    execSync("npm run build", { cwd: projectRoot, stdio: "inherit" });
  }

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "coderoast-demo-"));
  const demoRoot = path.join(tempRoot, "repo");
  await fsp.mkdir(demoRoot);
  await createDemoRepo(demoRoot);

  console.log(`Demo repo created at: ${demoRoot}`);
  execSync(
    `node "${distIndex}" --path "${demoRoot}" --severity savage --focus architecture --fix`,
    { cwd: projectRoot, stdio: "inherit", env: process.env }
  );

  if (keep) {
    console.log(`Keeping demo repo: ${demoRoot}`);
    return;
  }

  await fsp.rm(tempRoot, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
