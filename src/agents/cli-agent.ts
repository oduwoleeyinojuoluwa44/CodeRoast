import type { CliConfig, Focus, Severity } from "../types";

const DEFAULT_CONFIG: CliConfig = {
  path: ".",
  severity: "gentle",
  focus: "general",
};

const SEVERITIES: Severity[] = ["gentle", "savage", "investor-demo"];
const FOCUS_AREAS: Focus[] = [
  "architecture",
  "performance",
  "style",
  "security",
  "general",
];

function getArgValue(args: string[], name: string): string | undefined {
  const flag = `--${name}`;
  const prefix = `${flag}=`;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === flag) {
      return args[i + 1];
    }
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }
  }

  return undefined;
}

function coerceSeverity(value?: string): Severity {
  if (value && SEVERITIES.includes(value as Severity)) {
    return value as Severity;
  }
  return DEFAULT_CONFIG.severity;
}

function coerceFocus(value?: string): Focus {
  if (value && FOCUS_AREAS.includes(value as Focus)) {
    return value as Focus;
  }
  return DEFAULT_CONFIG.focus;
}

function parseNumber(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

export function runCliAgent(argv: string[]): CliConfig {
  return {
    path: getArgValue(argv, "path") ?? DEFAULT_CONFIG.path,
    severity: coerceSeverity(getArgValue(argv, "severity")),
    focus: coerceFocus(getArgValue(argv, "focus")),
    maxFileSizeMB: parseNumber(getArgValue(argv, "max-file-size-mb")),
    scanTimeoutMs: parseNumber(getArgValue(argv, "scan-timeout-ms")),
  };
}
