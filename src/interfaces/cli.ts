#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { discoverCapability, type DecisionEngine } from "../application/discovery.js";
import { enrichInputsFromGoal } from "../application/goal-inputs.js";
import type { BrowserSurface } from "../application/ports/browser-surface.js";
import type { HumanHandoffController } from "../application/ports/human-handoff.js";
import { replayCapabilityFromFile } from "../application/replay.js";
import { createPlaywrightSurface } from "../infrastructure/browser/playwright-surface.js";
import { createFileEvidenceStore } from "../infrastructure/evidence/file-evidence-store.js";
import { createOpenAiDecisionEngine } from "../infrastructure/model/openai-decision-engine.js";
import { createTerminalHandoffController } from "./terminal-handoff.js";

type CommandName = "discover" | "replay" | "replay-only";
type ResultKind = "success" | "configuration_error" | "hard_failure" | "known_business_outcome" | "recoverable_condition";

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

const DEFAULT_EVIDENCE_DIR = "evidence";

const HELP_TEXT = `mini-auto

Usage:
  mini-auto discover --goal <text> --target-url <url> [--inputs-json <json> | --inputs-file <path>] [--dry-run]
  mini-auto replay --artifact <path> [--goal <text>] [--inputs-json <json> | --inputs-file <path>]
  mini-auto replay-only --artifact <path> [--goal <text>] [--inputs-json <json> | --inputs-file <path>]

Commands:
  discover     ${COMMANDS.discover}
  replay       ${COMMANDS.replay}
  replay-only  ${COMMANDS["replay-only"]}

Environment:
  MINI_AUTO_MODEL_API_KEY  Required for discover unless --dry-run is set.
  MINI_AUTO_PASSWORD       Optional password input fallback when inputs omit password.
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

function validateCommand(parsed: ParsedArgs, env: NodeJS.ProcessEnv, evidenceDir = DEFAULT_EVIDENCE_DIR): CliResult {
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
      data: { goal, targetUrl, evidenceDir, inputs: readInputs(parsed.flags, env, { goal }), dryRun }
    };
  }

  const artifact = readStringFlag(parsed.flags, "artifact");
  const goal = readStringFlag(parsed.flags, "goal");
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
      goal,
      evidenceDir,
      inputs: readInputs(parsed.flags, env, { goal }),
      mode: parsed.command === "replay-only" ? "replay-only" : "replay",
      humanHandoff: true
    }
  };
}

function readInputs(
  flags: Map<string, string | boolean>,
  env: NodeJS.ProcessEnv,
  options: { goal?: string } = {}
): Record<string, unknown> {
  return enrichInputsFromGoal({ inputs: readInputsJson(flags), env, goal: options.goal });
}

function readInputsJson(flags: Map<string, string | boolean>): Record<string, unknown> {
  const inputsFile = readStringFlag(flags, "inputs-file");
  const raw = readStringFlag(flags, "inputs-json");

  if (inputsFile && raw) {
    throw new Error("Use either --inputs-json or --inputs-file, not both");
  }

  if (inputsFile) {
    return parseInputsJson(readFileSync(inputsFile, "utf8"));
  }

  if (!raw) {
    return {};
  }

  return parseInputsJson(raw);
}

function parseInputsJson(raw: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Replay inputs must be a JSON object");
  }
  return parsed as Record<string, unknown>;
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

function formatResult(result: CliResult): string {
  return JSON.stringify(result, null, 2);
}

export async function runCli(
  argv: string[],
  env?: NodeJS.ProcessEnv,
  deps: {
    replaySurface?: BrowserSurface;
    discoverySurface?: BrowserSurface;
    decisionEngine?: DecisionEngine;
    handoffController?: HumanHandoffController;
    evidenceDir?: string;
  } = {}
): Promise<{ result: CliResult; stdout: string; exitCode: number }> {
  const effectiveEnv = mergeDotEnv(env ?? process.env, env === undefined);
  const parsed = parseArgs(argv);
  let result: CliResult;

  try {
    result = validateCommand(parsed, effectiveEnv, deps.evidenceDir);
  } catch (error) {
    const command = parsed.command && isCommandName(parsed.command) ? parsed.command : undefined;
    result = {
      ok: false,
      kind: "configuration_error",
      command,
      message: "Command configuration is invalid.",
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }

  const evidenceStore = createFileEvidenceStore();

  if (
    result.ok &&
    result.command === "discover" &&
    result.data &&
    result.data.dryRun !== true &&
    typeof result.data.goal === "string" &&
    typeof result.data.targetUrl === "string" &&
    typeof result.data.evidenceDir === "string"
  ) {
    const discoveryResult = await discoverCapability({
      goal: result.data.goal,
      targetUrl: result.data.targetUrl,
      evidenceDir: result.data.evidenceDir,
      evidenceStore,
      inputs: readRecord(result.data.inputs),
      surface: deps.discoverySurface,
      surfaceFactory: deps.discoverySurface ? undefined : () => createPlaywrightSurface(),
      decisionEngine: deps.decisionEngine ?? createOpenAiDecisionEngine(effectiveEnv)
    });
    result = {
      ok: discoveryResult.ok,
      kind: discoveryResult.kind,
      command: result.command,
      message: discoveryResult.message,
      data: { discovery: discoveryResult }
    };
  }

  if (
    result.ok &&
    (result.command === "replay" || result.command === "replay-only") &&
    result.data &&
    typeof result.data.artifact === "string" &&
    typeof result.data.evidenceDir === "string"
  ) {
    try {
      const replayResult = await replayCapabilityFromFile({
        artifactPath: result.data.artifact,
        evidenceDir: result.data.evidenceDir,
        evidenceStore,
        inputs: readRecord(result.data.inputs),
        surface: deps.replaySurface,
        surfaceFactory: deps.replaySurface
          ? undefined
          : () =>
              createPlaywrightSurface({
                headless: false
              }),
        handoff: deps.handoffController ?? createTerminalHandoffController()
      });
      result = {
        ok: replayResult.ok,
        kind: replayResult.kind,
        command: result.command,
        message: replayResult.ok ? "Replay completed." : "Replay failed.",
        data: { replay: replayResult }
      };
    } catch (error) {
      result = {
        ok: false,
        kind: "configuration_error",
        command: result.command,
        message: "Replay configuration is invalid.",
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  return {
    result,
    stdout: formatResult(result),
    exitCode: result.ok ? 0 : 1
  };
}

function mergeDotEnv(env: NodeJS.ProcessEnv, loadDotEnv: boolean): NodeJS.ProcessEnv {
  if (!loadDotEnv) {
    return env;
  }

  if (env.MINI_AUTO_DOTENV === "0") {
    return env;
  }

  const fileValues = readDotEnvFile(path.resolve(".env"));
  if (Object.keys(fileValues).length === 0) {
    return env;
  }

  return { ...fileValues, ...env };
}

function readDotEnvFile(filePath: string): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : undefined;
    if (code === "ENOENT") {
      return {};
    }
    throw error;
  }

  const values: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const assignment = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const separator = assignment.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = assignment.slice(0, separator).trim();
    const value = assignment.slice(separator + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    values[key] = unquoteEnvValue(value);
  }

  return values;
}

function unquoteEnvValue(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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
