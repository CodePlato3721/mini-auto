import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  capabilityArtifactSchema,
  hardFailureReplayResult,
  parseCapabilityArtifact,
  successReplayResult,
  type CapabilityArtifact,
  type CapabilityStep,
  type LocatorCandidate,
  type ReplayHardFailureResult,
  type ReplaySuccessResult
} from "./contracts.js";
import {
  createPlaywrightSurface,
  type BrowserSurface,
  type FailureEvidenceContext,
  type ResolvedLocator
} from "./replay.js";

export type DiscoveryOptions = {
  goal: string;
  targetUrl: string;
  inputs: Record<string, unknown>;
  evidenceDir: string;
  decisionEngine?: DecisionEngine;
  surface?: BrowserSurface;
  maxSteps?: number;
};

export type DecisionEngine = {
  decide(observation: BrowserObservation, context: DiscoveryContext): Promise<unknown>;
};

export type BrowserObservation = {
  url: string;
  title: string;
  visibleText: string;
  interactiveControls: Array<{
    text: string;
    locatorCandidates: LocatorCandidate[];
  }>;
  screenshot?: string;
};

export type DiscoveryContext = {
  goal: string;
  targetUrl: string;
  stepNumber: number;
  priorSteps: CapabilityStep[];
  inputs: Record<string, unknown>;
};

export type DiscoveryResult =
  | (ReplaySuccessResult & { artifactPath: string; message: string })
  | (ReplayHardFailureResult & { message: string });

const decisionSchema = z.union([
  z.object({
    complete: z.literal(true),
    reason: z.string().optional()
  }),
  z.object({
    action: z.enum(["navigate", "click", "type", "wait", "extract", "checkpoint"]),
    description: z.string().min(1),
    target: z
      .object({
        locatorCandidates: z
          .array(
            z.object({
              strategy: z.enum(["testId", "role", "label", "text", "css", "xpath", "url", "relativeText", "visual"]),
              value: z.string().min(1),
              name: z.string().min(1).optional(),
              frame: z.string().min(1).optional(),
              confidence: z.number().min(0).max(1).optional()
            })
          )
          .min(1)
      })
      .optional(),
    inputBindings: z.record(z.string(), z.string()).default({}),
    outputBindings: z.record(z.string(), z.string()).default({}),
    risk: z.enum(["safe", "risky", "irreversible"]).default("safe")
  })
]);

type DiscoveryDecision = z.infer<typeof decisionSchema>;

export async function discoverCapability(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const evidenceDir = path.resolve(options.evidenceDir);
  const logger = createDiscoveryLogger(evidenceDir);
  let surface: BrowserSurface | undefined;
  const steps: CapabilityStep[] = [];
  const maxSteps = options.maxSteps ?? 30;
  const engine = options.decisionEngine ?? new OpenAiDecisionEngine(process.env.MINI_AUTO_MODEL_API_KEY);

  logger.append("discovery.started", {
    goal: options.goal,
    targetUrl: options.targetUrl,
    inputs: redactInputs(options.inputs)
  });

  try {
    surface = options.surface ?? (await createPlaywrightSurface());
    const target = new URL(options.targetUrl);
    let completed = false;

    for (let stepNumber = 1; stepNumber <= maxSteps; stepNumber += 1) {
      const observation = await observeSurface(surface, evidenceDir, stepNumber);
      logger.append("discovery.observed", sanitizeObservation(observation));

      const rawDecision = await engine.decide(observation, {
        goal: options.goal,
        targetUrl: options.targetUrl,
        stepNumber,
        priorSteps: steps,
        inputs: redactInputs(options.inputs)
      });
      const parsedDecision = decisionSchema.safeParse(rawDecision);
      if (!parsedDecision.success) {
        throw new DiscoveryError(
          `step-${String(stepNumber).padStart(3, "0")}`,
          "Structured discovery decision",
          parsedDecision.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        );
      }

      const decision = parsedDecision.data;
      logger.append("decision.accepted", { stepNumber, decision: redactDecision(decision, options.inputs) });

      if ("complete" in decision) {
        completed = true;
        break;
      }

      const step = toCapabilityStep(decision, stepNumber);
      assertDiscoveryStepAllowed(step, target);
      await executeDiscoveryStep(surface, step, options.inputs);
      steps.push(step);
      logger.append("step.recorded", { stepId: step.id, action: step.action });

      if (step.action === "checkpoint") {
        completed = true;
        break;
      }
    }

    if (steps.length === 0) {
      throw new DiscoveryError("discovery", "At least one successful action", "No successful actions were recorded");
    }

    if (!completed) {
      throw new DiscoveryError("discovery", "Goal completion within max steps", `Stopped after ${maxSteps} steps without completion`);
    }

    const artifact = buildArtifact({ goal: options.goal, targetUrl: options.targetUrl, inputs: options.inputs, target, steps });
    const parsedArtifact = parseCapabilityArtifact(artifact);
    if (!parsedArtifact.ok) {
      throw new DiscoveryError(
        "artifact.validation",
        "Replay-compatible artifact",
        parsedArtifact.errors.map((error) => `${error.path}: ${error.message}`).join("; ")
      );
    }

    const artifactPath = path.resolve(evidenceDir, "discovered-capability.json");
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(artifactPath, `${JSON.stringify(parsedArtifact.artifact, null, 2)}\n`, "utf8");
    logger.append("artifact.written", {
      artifactId: parsedArtifact.artifact.metadata.id,
      artifactPath,
      recordedStepCount: parsedArtifact.artifact.steps.length
    });
    await logger.flush();

    return {
      ...successReplayResult({
        artifactId: parsedArtifact.artifact.metadata.id,
        outputs: { artifactPath, recordedStepCount: parsedArtifact.artifact.steps.length },
        evidence: [logger.path]
      }),
      artifactPath,
      message: "Discovery completed."
    };
  } catch (error) {
    const stepId = error instanceof DiscoveryError ? error.stepId : "discovery";
    const result = hardFailureReplayResult({
      artifactId: "discovery",
      stepId,
      expected: error instanceof DiscoveryError ? error.expected : "Discovery should complete",
      observed: error instanceof Error ? redactString(error.message, options.inputs) : redactString(String(error), options.inputs),
      evidence: [
        logger.path,
        ...((await surface?.captureFailureEvidence?.({
          evidenceDir,
          artifactId: "discovery",
          stepId,
          redact: (value) => redactString(value, options.inputs)
        } satisfies FailureEvidenceContext)) ?? [])
      ]
    });
    logger.append("discovery.failed", { result });
    await logger.flush();
    return { ...result, message: "Discovery failed." };
  } finally {
    await surface?.close?.();
  }
}

async function observeSurface(surface: BrowserSurface, evidenceDir: string, stepNumber: number): Promise<BrowserObservation> {
  const screenshot = await surface.screenshot?.({
    evidenceDir,
    name: `discovery-observation-${String(stepNumber).padStart(3, "0")}`
  });

  return {
    url: await surface.currentUrl(),
    title: (await surface.title?.()) ?? "",
    visibleText: await surface.visibleText(),
    interactiveControls: (await surface.interactiveControls?.()) ?? [],
    screenshot
  };
}

async function executeDiscoveryStep(
  surface: BrowserSurface,
  step: CapabilityStep,
  inputs: Record<string, unknown>
): Promise<void> {
  switch (step.action) {
    case "navigate":
      await surface.navigate(requireLocator(step, "url").value);
      return;
    case "click":
      await surface.click(await resolveDiscoveryLocator(surface, step, inputs));
      return;
    case "type":
      await surface.type(await resolveDiscoveryLocator(surface, step, inputs), readInputValue(step, inputs));
      return;
    case "wait":
      await surface.wait(Number(step.inputBindings.milliseconds ?? 500));
      return;
    case "extract":
      await surface.extractText(await resolveDiscoveryLocator(surface, step, inputs));
      return;
    case "checkpoint":
      return;
    case "handoff":
      throw new DiscoveryError(step.id, "Discovery-supported action", "Handoff is not part of discovery ticket 05");
  }
}

async function resolveDiscoveryLocator(
  surface: BrowserSurface,
  step: CapabilityStep,
  inputs: Record<string, unknown>
): Promise<ResolvedLocator> {
  for (const candidate of step.target?.locatorCandidates ?? []) {
    const resolved = interpolateLocator(candidate, inputs);
    if (await surface.hasLocator(resolved)) {
      return { candidate: resolved, key: `${resolved.strategy}:${resolved.value}`, stepId: step.id };
    }
  }

  throw new DiscoveryError(step.id, "Resolvable locator", "No locator candidates matched");
}

function toCapabilityStep(decision: Exclude<DiscoveryDecision, { complete: true }>, stepNumber: number): CapabilityStep {
  return {
    id: `step-${String(stepNumber).padStart(3, "0")}`,
    action: decision.action,
    description: decision.description,
    target: decision.target,
    inputBindings: decision.inputBindings,
    outputBindings: decision.outputBindings,
    risk: decision.risk
  };
}

function assertDiscoveryStepAllowed(step: CapabilityStep, target: URL): void {
  if (step.risk !== "safe") {
    throw new DiscoveryError(step.id, "Safe discovery action", `Action risk ${step.risk} is not allowed during discovery`);
  }

  if (step.action === "handoff") {
    throw new DiscoveryError(step.id, "Discovery-supported action", "Handoff is not part of discovery ticket 05");
  }

  if (step.action === "navigate") {
    const url = new URL(requireLocator(step, "url").value);
    if (url.hostname !== target.hostname) {
      throw new DiscoveryError(step.id, "Allowed discovery URL", `Domain ${url.hostname} is outside ${target.hostname}`);
    }
  }
}

function buildArtifact(args: {
  goal: string;
  targetUrl: string;
  target: URL;
  inputs: Record<string, unknown>;
  steps: CapabilityStep[];
}): CapabilityArtifact {
  const inputNames = new Set<string>();
  const outputNames = new Set<string>();
  for (const inputName of Object.keys(args.inputs)) {
    inputNames.add(inputName);
  }

  for (const step of args.steps) {
    for (const inputName of Object.values(step.inputBindings)) {
      inputNames.add(inputName);
    }
    for (const outputName of Object.values(step.outputBindings)) {
      outputNames.add(outputName);
    }
  }

  return capabilityArtifactSchema.parse({
    schemaVersion: "1.0.0",
    metadata: {
      id: "discovered-sauce-demo-checkout",
      name: "Discovered Sauce Demo Checkout",
      description: args.goal,
      createdAt: new Date().toISOString(),
      source: "llm-discovery"
    },
    inputs: Array.from(inputNames).map((name) => ({
      name,
      type: "string",
      required: true,
      sensitive: name.toLowerCase().includes("password")
    })),
    outputs: [
      ...Array.from(outputNames).map((name) => ({ name, type: "string", required: false })),
      { name: "resultKind", type: "string", required: true }
    ],
    policy: {
      allowedDomains: [args.target.hostname],
      allowedRoutes: ["/", "/inventory.html", "/cart.html", "/checkout-step-one.html", "/checkout-step-two.html", "/checkout-complete.html"],
      allowedActions: ["navigate", "click", "type", "wait", "extract", "checkpoint"]
    },
    steps: args.steps,
    successCheckpoint: {
      id: "checkout-complete",
      urlIncludes: "/checkout-complete.html",
      textIncludes: ["Thank you for your order!"],
      outputAssertions: { resultKind: "success" }
    }
  });
}

function requireLocator(step: CapabilityStep, strategy: LocatorCandidate["strategy"]): LocatorCandidate {
  const locator = step.target?.locatorCandidates.find((candidate) => candidate.strategy === strategy);
  if (!locator) {
    throw new DiscoveryError(step.id, `${strategy} locator`, "Missing locator");
  }
  return locator;
}

function readInputValue(step: CapabilityStep, inputs: Record<string, unknown>): string {
  const inputName = step.inputBindings.value;
  const value = inputName ? inputs[inputName] : undefined;
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    throw new DiscoveryError(step.id, "Scalar invocation input", `Missing input ${inputName ?? "value"}`);
  }
  return String(value);
}

function interpolateLocator(candidate: LocatorCandidate, inputs: Record<string, unknown>): LocatorCandidate {
  return {
    ...candidate,
    value: interpolate(candidate.value, inputs),
    name: candidate.name ? interpolate(candidate.name, inputs) : undefined
  };
}

function interpolate(value: string, inputs: Record<string, unknown>): string {
  return value.replace(/\{\{([a-zA-Z0-9_-]+)\}\}/g, (_, name: string) => {
    const input = inputs[name];
    return input === undefined || input === null ? "" : String(input);
  });
}

function sanitizeObservation(observation: BrowserObservation): BrowserObservation {
  return {
    ...observation,
    visibleText: observation.visibleText.slice(0, 4000),
    interactiveControls: observation.interactiveControls.slice(0, 50)
  };
}

function redactDecision(decision: DiscoveryDecision, inputs: Record<string, unknown>): DiscoveryDecision {
  return JSON.parse(redactString(JSON.stringify(decision), inputs)) as DiscoveryDecision;
}

function redactInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(inputs).map(([name, value]) => [name, name.toLowerCase().includes("password") ? "[REDACTED]" : value])
  );
}

function redactString(value: string, inputs: Record<string, unknown>): string {
  return Object.entries(inputs).reduce((redacted, [name, inputValue]) => {
    if (!name.toLowerCase().includes("password")) {
      return redacted;
    }
    const sensitive = inputValue === undefined || inputValue === null ? "" : String(inputValue);
    return sensitive ? redacted.split(sensitive).join("[REDACTED]") : redacted;
  }, value);
}

type DiscoveryLog = {
  path: string;
  append(event: string, data: Record<string, unknown>): void;
  flush(): Promise<void>;
};

function createDiscoveryLogger(evidenceDir: string): DiscoveryLog {
  const logPath = path.resolve(evidenceDir, `discovery-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  const entries: string[] = [];
  return {
    path: logPath,
    append(event, data) {
      entries.push(JSON.stringify({ time: new Date().toISOString(), event, ...data }));
    },
    async flush() {
      await mkdir(path.dirname(logPath), { recursive: true });
      await writeFile(logPath, `${entries.join("\n")}\n`, "utf8");
    }
  };
}

class DiscoveryError extends Error {
  constructor(
    readonly stepId: string,
    readonly expected: string,
    observed: string
  ) {
    super(observed);
  }
}

class OpenAiDecisionEngine implements DecisionEngine {
  constructor(private readonly apiKey?: string) {}

  async decide(observation: BrowserObservation, context: DiscoveryContext): Promise<unknown> {
    if (!this.apiKey) {
      throw new DiscoveryError("decision", "MINI_AUTO_MODEL_API_KEY", "Missing model API key");
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.MINI_AUTO_MODEL ?? "gpt-5-mini",
        input: [
          {
            role: "system",
            content:
              "Return only JSON for the next browser action. Use one of navigate, click, type, wait, extract, checkpoint, or {\"complete\":true}. Do not include prose."
          },
          {
            role: "user",
            content: JSON.stringify({ observation: sanitizeObservation(observation), context })
          }
        ]
      })
    });

    if (!response.ok) {
      throw new DiscoveryError("decision", "Successful model response", `${response.status} ${await response.text()}`);
    }

    const body = (await response.json()) as unknown;
    const outputText = extractResponseText(body);
    if (!outputText) {
      throw new DiscoveryError("decision", "Model output_text JSON", JSON.stringify(body));
    }

    return JSON.parse(outputText) as unknown;
  }
}

function extractResponseText(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }

  if ("output_text" in body && typeof body.output_text === "string") {
    return body.output_text;
  }

  const output = "output" in body && Array.isArray(body.output) ? body.output : [];
  for (const item of output) {
    if (typeof item !== "object" || item === null || !("content" in item) || !Array.isArray(item.content)) {
      continue;
    }
    for (const content of item.content) {
      if (typeof content === "object" && content !== null && "text" in content && typeof content.text === "string") {
        return content.text;
      }
    }
  }

  return undefined;
}
