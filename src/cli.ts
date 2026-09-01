#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { discoverCapability, type DecisionEngine } from "./discovery.js";
import {
  createTerminalHandoffController,
  replayCapabilityFromFile,
  type BrowserSurface,
  type HumanHandoffController
} from "./replay.js";

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

const HELP_TEXT = `mini-auto

Usage:
  mini-auto discover --goal <text> --target-url <url> [--inputs-json <json> | --inputs-file <path>] [--dry-run] [--json]
  mini-auto replay --artifact <path> [--goal <text>] [--inputs-json <json> | --inputs-file <path>] [--human-handoff] [--json]
  mini-auto replay-only --artifact <path> [--goal <text>] [--inputs-json <json> | --inputs-file <path>] [--human-handoff] [--json]

Commands:
  discover     ${COMMANDS.discover}
  replay       ${COMMANDS.replay}
  replay-only  ${COMMANDS["replay-only"]}

Environment:
  MINI_AUTO_EVIDENCE_DIR   Directory for evidence output. Defaults to ./evidence.
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
      humanHandoff: parsed.flags.has("human-handoff")
    }
  };
}

function readInputs(
  flags: Map<string, string | boolean>,
  env: NodeJS.ProcessEnv,
  options: { goal?: string } = {}
): Record<string, unknown> {
  const inputs = readInputsJson(flags);
  if (inputs.password === undefined && env.MINI_AUTO_PASSWORD) {
    inputs.password = env.MINI_AUTO_PASSWORD;
  }

  if (inputs.username === undefined && options.goal) {
    const username = inferSauceDemoUsername(options.goal);
    if (username) {
      inputs.username = username;
    }
  }

  if (inputs.productName === undefined && options.goal) {
    const productName = inferSauceDemoProductName(options.goal);
    if (productName) {
      inputs.productName = productName;
    }
  }

  return inputs;
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

function inferSauceDemoUsername(goal: string): string | undefined {
  const knownUsernames = [
    "standard_user",
    "locked_out_user",
    "problem_user",
    "performance_glitch_user",
    "error_user",
    "visual_user"
  ];
  const normalizedGoal = goal.toLowerCase();
  return knownUsernames.find((username) => normalizedGoal.includes(username.toLowerCase()));
}

function inferSauceDemoProductName(goal: string): string | undefined {
  const knownProducts = [
    "Sauce Labs Backpack",
    "Sauce Labs Bike Light",
    "Sauce Labs Bolt T-Shirt",
    "Sauce Labs Fleece Jacket",
    "Sauce Labs Onesie",
    "Test.allTheThings() T-Shirt (Red)"
  ];
  const normalizedGoal = goal.toLowerCase();
  return knownProducts.find((product) => normalizedGoal.includes(product.toLowerCase()));
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
  env: NodeJS.ProcessEnv = process.env,
  deps: {
    replaySurface?: BrowserSurface;
    discoverySurface?: BrowserSurface;
    decisionEngine?: DecisionEngine;
    handoffController?: HumanHandoffController;
  } = {}
): Promise<{ result: CliResult; stdout: string; exitCode: number }> {
  const parsed = parseArgs(argv);
  const asJson = parsed.flags.has("json");
  let result: CliResult;

  try {
    result = validateCommand(parsed, env);
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

  if (result.ok && result.data && typeof result.data.evidenceDir === "string") {
    await mkdir(path.resolve(result.data.evidenceDir), { recursive: true });
  }

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
      inputs: readRecord(result.data.inputs),
      surface: deps.discoverySurface,
      decisionEngine: deps.decisionEngine
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
        inputs: readRecord(result.data.inputs),
        surface: deps.replaySurface,
        handoff: result.data.humanHandoff === true ? deps.handoffController ?? createTerminalHandoffController() : undefined,
        browser: {
          headless: result.data.humanHandoff !== true
        }
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
    stdout: formatResult(result, asJson),
    exitCode: result.ok ? 0 : 1
  };
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
