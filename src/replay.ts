import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type Browser, type Locator, type Page } from "playwright";

import {
  hardFailureReplayResult,
  parseCapabilityArtifact,
  redactInvocationInputs,
  successReplayResult,
  type CapabilityArtifact,
  type CapabilityArtifactInput,
  type CapabilityStep,
  type LocatorCandidate,
  type ReplayResult
} from "./contracts.js";

export type ReplayOptions = {
  artifactInput: unknown;
  inputs: Record<string, unknown>;
  evidenceDir: string;
  surface?: BrowserSurface;
};

export type ReplayFromFileOptions = Omit<ReplayOptions, "artifactInput"> & {
  artifactPath: string;
};

export type BrowserSurface = {
  navigate(url: string): Promise<void>;
  click(locator: ResolvedLocator): Promise<void>;
  type(locator: ResolvedLocator, value: string): Promise<void>;
  wait(milliseconds: number): Promise<void>;
  extractText(locator: ResolvedLocator): Promise<string>;
  hasLocator(candidate: LocatorCandidate): Promise<boolean>;
  currentUrl(): Promise<string>;
  visibleText(): Promise<string>;
  title?(): Promise<string>;
  interactiveControls?(): Promise<ObservedControl[]>;
  screenshot?(context: { evidenceDir: string; name: string }): Promise<string>;
  captureFailureEvidence?(context: FailureEvidenceContext): Promise<string[]>;
  close?(): Promise<void>;
};

export type ObservedControl = {
  text: string;
  locatorCandidates: LocatorCandidate[];
};

export type ResolvedLocator = {
  candidate: LocatorCandidate;
  key: string;
  stepId: string;
};

type EvidenceLogger = {
  path: string;
  append(event: string, data: Record<string, unknown>): void;
  flush(): Promise<void>;
};

type MemorySurfaceOptions = {
  initialUrl?: string;
  finalUrl?: string;
  visibleText?: string;
  locators?: Record<string, string>;
};

type MemoryCall = {
  type: "navigate" | "click" | "type" | "wait" | "extract" | "checkpoint";
  stepId?: string;
  locator?: string;
  value?: string;
};

export type MemorySurface = BrowserSurface & {
  calls: MemoryCall[];
};

export type FailureEvidenceContext = {
  evidenceDir: string;
  artifactId: string;
  stepId: string;
  redact: (value: string) => string;
};

export async function replayCapabilityFromFile(options: ReplayFromFileOptions): Promise<ReplayResult> {
  const artifactBody = await readFile(options.artifactPath, "utf8");
  return replayCapability({
    ...options,
    artifactInput: JSON.parse(artifactBody)
  });
}

export async function replayCapability(options: ReplayOptions): Promise<ReplayResult> {
  const logger = createEvidenceLogger(options.evidenceDir);
  const parsed = parseCapabilityArtifact(options.artifactInput);

  if (!parsed.ok) {
    const result = hardFailureReplayResult({
      artifactId: readArtifactId(options.artifactInput),
      stepId: "artifact.validation",
      expected: "A valid capability artifact",
      observed: parsed.errors.map((error) => `${error.path}: ${error.message}`).join("; "),
      evidence: [logger.path]
    });
    logger.append("replay.failed", { result });
    await logger.flush();
    return result;
  }

  const artifact = parsed.artifact;
  const missingInputs = artifact.inputs
    .filter((input) => input.required && options.inputs[input.name] === undefined)
    .map((input) => input.name);

  if (missingInputs.length > 0) {
    const result = hardFailureReplayResult({
      artifactId: artifact.metadata.id,
      stepId: "invocation.inputs",
      expected: "All required invocation inputs",
      observed: `Missing inputs: ${missingInputs.join(", ")}`,
      evidence: [logger.path]
    });
    logger.append("replay.failed", { result });
    await logger.flush();
    return result;
  }

  const surface = options.surface ?? (await createPlaywrightSurface());
  const outputs: Record<string, unknown> = {};
  const redactor = createRedactor(artifact, options.inputs);

  logger.append("replay.started", {
    artifactId: artifact.metadata.id,
    schemaVersion: artifact.schemaVersion,
    stepCount: artifact.steps.length,
    inputs: redactInvocationInputs(artifact, options.inputs)
  });

  try {
    for (const step of artifact.steps) {
      logger.append("step.started", {
        artifactId: artifact.metadata.id,
        stepId: step.id,
        action: step.action,
        risk: step.risk
      });

      await executeStep({ artifact, step, inputs: options.inputs, outputs, surface });
      await assertCurrentRouteAllowed(artifact, step, surface);

      logger.append("step.succeeded", {
        artifactId: artifact.metadata.id,
        stepId: step.id,
        action: step.action
      });
    }

    await assertCheckpoint(artifact, surface, outputs);
    const result = successReplayResult({
      artifactId: artifact.metadata.id,
      outputs,
      evidence: [logger.path]
    });
    logger.append("replay.completed", { result });
    await logger.flush();
    return result;
  } catch (error) {
    const stepId = error instanceof ReplayStepError ? error.stepId : "replay";
    const richerEvidence = await surface.captureFailureEvidence?.({
      evidenceDir: options.evidenceDir,
      artifactId: artifact.metadata.id,
      stepId,
      redact: redactor
    });
    const result = hardFailureReplayResult({
      artifactId: artifact.metadata.id,
      stepId,
      expected: error instanceof ReplayStepError ? error.expected : "Replay should complete without throwing",
      observed: redactor(error instanceof Error ? error.message : String(error)),
      evidence: [logger.path, ...(richerEvidence ?? [])]
    });
    logger.append("replay.failed", { result });
    await logger.flush();
    return result;
  } finally {
    await surface.close?.();
  }
}

async function executeStep(args: {
  artifact: CapabilityArtifact;
  step: CapabilityStep;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  surface: BrowserSurface;
}): Promise<void> {
  const { artifact, step, inputs, outputs, surface } = args;

  assertStepAllowed(artifact, step);

  switch (step.action) {
    case "navigate": {
      const url = firstLocator(step, "url").value;
      assertAllowedUrl(artifact, step, url);
      await surface.navigate(url);
      return;
    }
    case "click": {
      await surface.click(await resolveLocator(surface, step, inputs));
      return;
    }
    case "type": {
      const value = readInputValue(step, inputs);
      await surface.type(await resolveLocator(surface, step, inputs), value);
      return;
    }
    case "wait": {
      await surface.wait(readWaitMilliseconds(step));
      return;
    }
    case "extract": {
      const text = await surface.extractText(await resolveLocator(surface, step, inputs));
      for (const outputName of Object.values(step.outputBindings)) {
        outputs[outputName] = text;
      }
      return;
    }
    case "checkpoint": {
      await assertCheckpoint(artifact, surface, outputs);
      return;
    }
    case "handoff":
      throw new ReplayStepError(step.id, "Deterministic replay action", "Handoff is not implemented until the handoff ticket");
  }
}

function assertStepAllowed(artifact: CapabilityArtifact, step: CapabilityStep): void {
  if (!artifact.policy.allowedActions.includes(step.action)) {
    throw new ReplayStepError(step.id, "Allowed action in policy", `Action ${step.action} is not allowed`);
  }

  if (step.risk !== "safe") {
    throw new ReplayStepError(
      step.id,
      "Safe or explicitly handled action",
      `Action risk ${step.risk} requires ${artifact.policy.riskyActionHandling}`
    );
  }
}

async function resolveLocator(
  surface: BrowserSurface,
  step: CapabilityStep,
  inputs: Record<string, unknown>
): Promise<ResolvedLocator> {
  if (!step.target) {
    throw new ReplayStepError(step.id, "Step target with locator candidates", "No target was declared");
  }

  for (const rawCandidate of step.target.locatorCandidates) {
    const candidate = interpolateLocator(rawCandidate, inputs);
    if (await surface.hasLocator(candidate)) {
      return {
        candidate,
        key: locatorKey(candidate),
        stepId: step.id
      };
    }
  }

  throw new ReplayStepError(
    step.id,
    "At least one locator candidate should resolve",
    `No locator candidate matched: ${step.target.locatorCandidates.map(locatorKey).join(", ")}`
  );
}

async function assertCheckpoint(
  artifact: CapabilityArtifact,
  surface: BrowserSurface,
  outputs: Record<string, unknown>
): Promise<void> {
  const currentUrl = await surface.currentUrl();
  if (artifact.successCheckpoint.urlIncludes && !currentUrl.includes(artifact.successCheckpoint.urlIncludes)) {
    throw new ReplayStepError(
      artifact.successCheckpoint.id,
      `URL containing ${artifact.successCheckpoint.urlIncludes}`,
      `Current URL was ${currentUrl}`
    );
  }

  const text = await surface.visibleText();
  for (const expectedText of artifact.successCheckpoint.textIncludes) {
    if (!text.includes(expectedText)) {
      throw new ReplayStepError(
        artifact.successCheckpoint.id,
        `Visible text containing ${expectedText}`,
        `Visible text was ${text}`
      );
    }
  }

  for (const [outputName, expectedValue] of Object.entries(artifact.successCheckpoint.outputAssertions)) {
    outputs[outputName] = expectedValue;
  }
}

function firstLocator(step: CapabilityStep, strategy: LocatorCandidate["strategy"]): LocatorCandidate {
  const locator = step.target?.locatorCandidates.find((candidate) => candidate.strategy === strategy);
  if (!locator) {
    throw new ReplayStepError(step.id, `${strategy} locator candidate`, "No matching locator was declared");
  }
  return locator;
}

function readInputValue(step: CapabilityStep, inputs: Record<string, unknown>): string {
  const inputName = step.inputBindings.value;
  if (!inputName) {
    throw new ReplayStepError(step.id, "inputBindings.value", "No input binding was declared for type action");
  }

  const value = inputs[inputName];
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    throw new ReplayStepError(step.id, `Invocation input ${inputName}`, "Input value was missing or not scalar");
  }

  return String(value);
}

function readWaitMilliseconds(step: CapabilityStep): number {
  const value = step.inputBindings.milliseconds ?? step.inputBindings.timeoutMs ?? "500";
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ReplayStepError(step.id, "Non-negative wait duration", `Received ${value}`);
  }
  return parsed;
}

function assertAllowedUrl(artifact: CapabilityArtifact, step: CapabilityStep, value: string): void {
  const url = new URL(value);
  assertUrlAllowed(artifact, step, url);
}

async function assertCurrentRouteAllowed(
  artifact: CapabilityArtifact,
  step: CapabilityStep,
  surface: BrowserSurface
): Promise<void> {
  const currentUrl = await surface.currentUrl();
  if (!currentUrl.startsWith("http://") && !currentUrl.startsWith("https://")) {
    return;
  }

  assertUrlAllowed(artifact, step, new URL(currentUrl));
}

function assertUrlAllowed(artifact: CapabilityArtifact, step: CapabilityStep, url: URL): void {
  if (!artifact.policy.allowedDomains.includes(url.hostname)) {
    throw new ReplayStepError(step.id, "Allowed domain", `Domain ${url.hostname} is not allowed`);
  }

  if (!artifact.policy.allowedRoutes.some((route) => url.pathname === route || url.pathname.startsWith(`${route}/`))) {
    throw new ReplayStepError(step.id, "Allowed route", `Route ${url.pathname} is not allowed`);
  }
}

function createEvidenceLogger(evidenceDir: string): EvidenceLogger {
  const evidencePath = path.resolve(evidenceDir, `replay-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  const entries: string[] = [];

  return {
    path: evidencePath,
    append(event, data) {
      entries.push(JSON.stringify({ time: new Date().toISOString(), event, ...data }));
    },
    async flush() {
      await mkdir(path.dirname(evidencePath), { recursive: true });
      await writeFile(evidencePath, `${entries.join("\n")}\n`, "utf8");
    }
  };
}

function readArtifactId(value: unknown): string {
  if (typeof value !== "object" || value === null || !("metadata" in value)) {
    return "unknown";
  }

  const metadata = (value as { metadata?: unknown }).metadata;
  if (typeof metadata !== "object" || metadata === null || !("id" in metadata)) {
    return "unknown";
  }

  const id = (metadata as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : "unknown";
}

function locatorKey(candidate: LocatorCandidate): string {
  return `${candidate.strategy}:${candidate.value}`;
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

class ReplayStepError extends Error {
  constructor(
    readonly stepId: string,
    readonly expected: string,
    observed: string
  ) {
    super(observed);
  }
}

export function createMemorySurface(options: MemorySurfaceOptions = {}): MemorySurface {
  let url = options.initialUrl ?? "about:blank";
  const visibleText = options.visibleText ?? "";
  const locators = options.locators ?? {};
  const calls: MemoryCall[] = [];

  return {
    calls,
    async navigate(nextUrl) {
      calls.push({ type: "navigate", stepId: "open-login", value: nextUrl });
      url = nextUrl;
    },
    async click(locator) {
      calls.push({ type: "click", locator: locator.key, stepId: locator.stepId });
      if (options.finalUrl) {
        url = options.finalUrl;
      }
    },
    async type(locator, value) {
      calls.push({ type: "type", locator: locator.key, value, stepId: locator.stepId });
    },
    async wait(milliseconds) {
      calls.push({ type: "wait", value: String(milliseconds) });
    },
    async extractText(locator) {
      calls.push({ type: "extract", locator: locator.key, stepId: locator.stepId });
      return locators[locator.key] ?? "";
    },
    async hasLocator(candidate) {
      return locatorKey(candidate) in locators;
    },
    async currentUrl() {
      return url;
    },
    async visibleText() {
      return visibleText;
    },
    async title() {
      return "Memory Surface";
    },
    async interactiveControls() {
      return Object.keys(locators).map((key) => {
        const [strategy, ...valueParts] = key.split(":");
        return {
          text: locators[key],
          locatorCandidates: [{ strategy: strategy as LocatorCandidate["strategy"], value: valueParts.join(":") }]
        };
      });
    },
    async screenshot(context) {
      const screenshotPath = path.resolve(context.evidenceDir, `${context.name}.txt`);
      await mkdir(path.dirname(screenshotPath), { recursive: true });
      await writeFile(screenshotPath, visibleText, "utf8");
      return screenshotPath;
    },
    async captureFailureEvidence(context) {
      const snapshotPath = path.resolve(context.evidenceDir, `${context.artifactId}-${context.stepId}-snapshot.txt`);
      await mkdir(path.dirname(snapshotPath), { recursive: true });
      await writeFile(snapshotPath, context.redact(`URL: ${url}\n\n${visibleText}\n`), "utf8");
      return [snapshotPath];
    }
  };
}

export async function createPlaywrightSurface(): Promise<BrowserSurface> {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  return new PlaywrightSurface(browser, page);
}

class PlaywrightSurface implements BrowserSurface {
  constructor(
    private readonly browser: Browser,
    private readonly page: Page
  ) {}

  async navigate(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
  }

  async click(locator: ResolvedLocator): Promise<void> {
    await this.toLocator(locator).click();
  }

  async type(locator: ResolvedLocator, value: string): Promise<void> {
    await this.toLocator(locator).fill(value);
  }

  async wait(milliseconds: number): Promise<void> {
    await this.page.waitForTimeout(milliseconds);
  }

  async extractText(locator: ResolvedLocator): Promise<string> {
    return (await this.toLocator(locator).textContent())?.trim() ?? "";
  }

  async hasLocator(candidate: LocatorCandidate): Promise<boolean> {
    return (await this.toLocator({ candidate, key: locatorKey(candidate), stepId: "locator-check" }).count()) > 0;
  }

  async currentUrl(): Promise<string> {
    return this.page.url();
  }

  async visibleText(): Promise<string> {
    return await this.page.locator("body").innerText();
  }

  async title(): Promise<string> {
    return await this.page.title();
  }

  async interactiveControls(): Promise<ObservedControl[]> {
    return await this.page.locator("a,button,input,select,textarea,[role=button]").evaluateAll((nodes) =>
      nodes.slice(0, 50).map((node) => {
        const element = node as HTMLElement;
        const testId = element.getAttribute("data-test") ?? element.getAttribute("data-testid");
        const label = element.getAttribute("aria-label") ?? element.getAttribute("name") ?? element.innerText ?? element.getAttribute("value") ?? "";
        const locatorCandidates = testId
          ? [{ strategy: "testId" as const, value: testId }]
          : [{ strategy: "text" as const, value: label.trim() }];
        return {
          text: label.trim(),
          locatorCandidates
        };
      })
    );
  }

  async screenshot(context: { evidenceDir: string; name: string }): Promise<string> {
    await mkdir(context.evidenceDir, { recursive: true });
    const screenshotPath = path.resolve(context.evidenceDir, `${context.name}.png`);
    await this.page.screenshot({ path: screenshotPath, fullPage: true });
    return screenshotPath;
  }

  async close(): Promise<void> {
    await this.browser.close();
  }

  async captureFailureEvidence(context: FailureEvidenceContext): Promise<string[]> {
    await mkdir(context.evidenceDir, { recursive: true });
    const base = path.resolve(context.evidenceDir, `${context.artifactId}-${context.stepId}`);
    const screenshotPath = `${base}.png`;
    const snapshotPath = `${base}.html`;
    await this.page.screenshot({ path: screenshotPath, fullPage: true });
    await writeFile(snapshotPath, context.redact(await this.page.content()), "utf8");
    return [screenshotPath, snapshotPath];
  }

  private toLocator(locator: ResolvedLocator): Locator {
    const { candidate } = locator;
    switch (candidate.strategy) {
      case "testId":
        return this.page.locator(`[data-test="${candidate.value}"], [data-testid="${candidate.value}"]`);
      case "role":
        return this.page.getByRole("button", { name: candidate.name ?? candidate.value });
      case "label":
        return this.page.getByLabel(candidate.value);
      case "text":
        return this.page.getByText(candidate.value);
      case "relativeText": {
        const [anchor, target] = candidate.value.split(">>").map((part) => part.trim());
        if (anchor && target) {
          return this.page
            .getByText(anchor, { exact: true })
            .locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' inventory_item ')][1]")
            .getByRole("button", { name: target });
        }
        return this.page.getByText(candidate.value);
      }
      case "css":
        return this.page.locator(candidate.value);
      case "xpath":
        return this.page.locator(`xpath=${candidate.value}`);
      case "url":
        return this.page.locator("body");
      case "visual":
        throw new Error("Visual locators are not supported by the Playwright adapter yet");
    }
  }
}

function createRedactor(artifact: CapabilityArtifact, inputs: Record<string, unknown>): (value: string) => string {
  const sensitiveValues = artifact.inputs
    .filter((input) => input.sensitive)
    .map((input) => inputs[input.name])
    .filter((value): value is string | number | boolean => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .map(String)
    .filter((value) => value.length > 0);

  return (value: string) =>
    sensitiveValues.reduce((redacted, sensitiveValue) => redacted.split(sensitiveValue).join("[REDACTED]"), value);
}
