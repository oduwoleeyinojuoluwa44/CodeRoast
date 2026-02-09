#!/usr/bin/env node
import "dotenv/config";
import { runPipeline } from "./pipeline";

runPipeline(process.argv.slice(2))
  .then((output) => {
    process.stdout.write(output);
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
