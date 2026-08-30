#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

type CommandName = "discover" | "replay" | "replay-only";
type ResultKind = "success" | "configuration_error";

type CliResult = {
  ok: boolean;
  kind: ResultKind;
  command?: CommandName;
  message: string;
  data?: Record<string, unknown>;
  errors?: string[];
};

type ParsedArgs = {
  command?: string;
  flags: Map<string, string | boolean>;
  positionals: string[];
};

const COMMANDS: Record<CommandName, string> = {
  discover: "Start an LLM-driven discovery run for a goal and target URL.",
  replay: "Replay a saved capability artifact deterministically.",
  "replay-only": "Alias for replay, intended for demos without live model calls."
};

const HELP_TEXT = `mini-auto

Usage:
  mini-auto discover --goal <text> --target-url <url> [--dry-run] [--json]
  mini-auto replay --artifact <path> [--json]
  mini-auto replay-only --artifact <path> [--json]

Commands:
  discover     ${COMMANDS.discover}
  replay       ${COMMANDS.replay}
  replay-only  ${COMMANDS["replay-only"]}

Environment:
  MINI_AUTO_EVIDENCE_DIR   Directory for evidence output. Defaults to ./evidence.
  MINI_AUTO_MODEL_API_KEY  Required for discover unless --dry-run is set.
`;

function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0]?.startsWith("--") ? undefined : argv[0];
  const rest = command ? argv.slice(1) : argv;
  const flags = new Map<string, string | boolean>();
  const positionals: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const withoutPrefix = token.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");
    if (equalsIndex >= 0) {
      flags.set(withoutPrefix.slice(0, equalsIndex), withoutPrefix.slice(equalsIndex + 1));
      continue;
    }

    const next = rest[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(withoutPrefix, next);
      index += 1;
    } else {
      flags.set(withoutPrefix, true);
    }
  }

  return { command, flags, positionals };
}

function readStringFlag(flags: Map<string, string | boolean>, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function validateCommand(parsed: ParsedArgs, env: NodeJS.ProcessEnv): CliResult {
  if (!parsed.command || parsed.flags.has("help") || parsed.flags.has("h")) {
    return {
      ok: true,
      kind: "success",
      message: HELP_TEXT,
      data: { commands: Object.keys(COMMANDS) }
    };
  }

  if (!isCommandName(parsed.command)) {
    return {
      ok: false,
      kind: "configuration_error",
      message: `Unknown command: ${parsed.command}`,
      errors: [`Expected one of: ${Object.keys(COMMANDS).join(", ")}`]
    };
  }

  const evidenceDir = env.MINI_AUTO_EVIDENCE_DIR?.trim() || "evidence";

  if (parsed.command === "discover") {
    const goal = readStringFlag(parsed.flags, "goal");
    const targetUrl = readStringFlag(parsed.flags, "target-url");
    const dryRun = parsed.flags.has("dry-run");
    const errors = [
      goal ? undefined : "Missing required flag: --goal <text>",
      targetUrl ? undefined : "Missing required flag: --target-url <url>",
      targetUrl && !isHttpUrl(targetUrl) ? "Invalid --target-url: expected an http(s) URL" : undefined,
      !dryRun && !env.MINI_AUTO_MODEL_API_KEY ? "Missing required env var: MINI_AUTO_MODEL_API_KEY" : undefined
    ].filter((error): error is string => Boolean(error));

    if (errors.length > 0) {
      return {
        ok: false,
        kind: "configuration_error",
        command: parsed.command,
        message: "Discovery configuration is invalid.",
        errors
      };
    }

    return {
      ok: true,
      kind: "success",
      command: parsed.command,
      message: dryRun ? "Discovery command validated in dry-run mode." : "Discovery command validated.",
      data: { goal, targetUrl, evidenceDir, dryRun }
    };
  }

  const artifact = readStringFlag(parsed.flags, "artifact");
  if (!artifact) {
    return {
      ok: false,
      kind: "configuration_error",
      command: parsed.command,
      message: "Replay configuration is invalid.",
      errors: ["Missing required flag: --artifact <path>"]
    };
  }

  return {
    ok: true,
    kind: "success",
    command: parsed.command,
    message: "Replay command validated.",
    data: {
      artifact,
      evidenceDir,
      mode: parsed.command === "replay-only" ? "replay-only" : "replay"
    }
  };
}

function isCommandName(command: string): command is CommandName {
  return command === "discover" || command === "replay" || command === "replay-only";
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function formatResult(result: CliResult, asJson: boolean): string {
  if (asJson) {
    return JSON.stringify(result, null, 2);
  }

  if (result.ok && result.message === HELP_TEXT) {
    return HELP_TEXT;
  }

  const lines = [`${result.ok ? "OK" : "ERROR"}: ${result.message}`];
  for (const error of result.errors ?? []) {
    lines.push(`- ${error}`);
  }
  return lines.join("\n");
}

export async function runCli(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<{ result: CliResult; stdout: string; exitCode: number }> {
  const parsed = parseArgs(argv);
  const asJson = parsed.flags.has("json");
  const result = validateCommand(parsed, env);

  if (result.ok && result.data && typeof result.data.evidenceDir === "string") {
    await mkdir(path.resolve(result.data.evidenceDir), { recursive: true });
  }

  return {
    result,
    stdout: formatResult(result, asJson),
    exitCode: result.ok ? 0 : 1
  };
}

async function main(): Promise<void> {
  const { stdout, exitCode } = await runCli(process.argv.slice(2));
  process.stdout.write(`${stdout}\n`);
  process.exitCode = exitCode;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  void main();
}
