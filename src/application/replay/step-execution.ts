import type { CapabilityArtifact, CapabilityStep } from "../../domain/contracts.js";
import type { EvidenceLog, EvidenceStore } from "../evidence.js";
import type { BrowserSurface } from "../ports/browser-surface.js";
import type { AutomationOwnership, HumanHandoffController } from "../ports/human-handoff.js";
import { ReplayOutcomeError, ReplayStepError } from "./errors.js";
import { requestHumanHandoff } from "./handoff.js";
import { firstLocator, interpolateLocator, resolveLocator } from "./locators.js";
import { assertCheckpoint, throwKnownOutcomeForLocatorMiss } from "./outcomes.js";
import { assertAllowedUrl, ensureStepAllowed } from "./policy.js";

export async function executeStepWithStuckHandoff(args: {
  artifact: CapabilityArtifact;
  step: CapabilityStep;
  stepIndex: number;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  surface: BrowserSurface;
  logger: EvidenceLog;
  handoff?: HumanHandoffController;
  evidenceDir: string;
  evidenceStore: EvidenceStore;
  redactor: (value: string) => string;
  ownership: AutomationOwnership;
}): Promise<{ ownership: AutomationOwnership; completed: boolean; nextStepIndex?: number }> {
  try {
    return { ownership: await executeStep(args), completed: true };
  } catch (error) {
    if (
      !args.handoff ||
      args.step.action === "handoff" ||
      error instanceof ReplayOutcomeError ||
      !(error instanceof ReplayStepError)
    ) {
      throw error;
    }

    const ownership = await requestHumanHandoff({
      ...args,
      reason: "stuck_replay_state",
      expected: error.expected
    });
    const nextStepIndex = await findResumableStepIndex(args);
    if (nextStepIndex !== undefined && nextStepIndex > args.stepIndex) {
      args.logger.append("handoff.fast_forwarded", {
        artifactId: args.artifact.metadata.id,
        fromStepId: args.step.id,
        toStepId: args.artifact.steps[nextStepIndex]?.id,
        reason: "operator_resumed_on_future_step"
      });
      return { ownership, completed: false, nextStepIndex };
    }

    args.logger.append("handoff.retrying_step", {
      artifactId: args.artifact.metadata.id,
      stepId: args.step.id,
      reason: "operator_resumed_after_stuck_state"
    });
    return {
      ownership: await executeStep({
        ...args,
        ownership
      }),
      completed: true
    };
  }
}

async function findResumableStepIndex(args: {
  artifact: CapabilityArtifact;
  stepIndex: number;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  surface: BrowserSurface;
}): Promise<number | undefined> {
  for (let index = args.stepIndex; index < args.artifact.steps.length; index += 1) {
    if (await isStepActionable(args.artifact.steps[index], args.inputs, args.outputs, args.surface)) {
      return index;
    }
  }

  return undefined;
}

async function isStepActionable(
  step: CapabilityStep,
  inputs: Record<string, unknown>,
  outputs: Record<string, unknown>,
  surface: BrowserSurface
): Promise<boolean> {
  switch (step.action) {
    case "click":
    case "type":
    case "extract":
      return step.target ? await hasAnyLocator(surface, step, inputs) : false;
    case "checkpoint":
      return false;
    case "handoff":
    case "wait":
      return true;
    case "navigate":
      return false;
  }
}

async function hasAnyLocator(
  surface: BrowserSurface,
  step: CapabilityStep,
  inputs: Record<string, unknown>
): Promise<boolean> {
  if (!step.target) {
    return false;
  }

  for (const rawCandidate of step.target.locatorCandidates) {
    if (await surface.hasLocator(interpolateLocator(rawCandidate, inputs))) {
      return true;
    }
  }

  return false;
}

async function executeStep(args: {
  artifact: CapabilityArtifact;
  step: CapabilityStep;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  surface: BrowserSurface;
  logger: EvidenceLog;
  handoff?: HumanHandoffController;
  evidenceDir: string;
  evidenceStore: EvidenceStore;
  redactor: (value: string) => string;
  ownership: AutomationOwnership;
}): Promise<AutomationOwnership> {
  const { artifact, step, inputs, outputs, surface, logger } = args;

  let ownership = await ensureStepAllowed(args);

  switch (step.action) {
    case "navigate": {
      const url = firstLocator(step, "url").value;
      assertAllowedUrl(artifact, step, url);
      await surface.navigate(url);
      return ownership;
    }
    case "click": {
      await surface.click(await resolveLocator(surface, step, inputs, logger, () => throwKnownOutcomeForLocatorMiss(step, inputs)));
      return ownership;
    }
    case "type": {
      const value = readInputValue(step, inputs);
      await surface.type(await resolveLocator(surface, step, inputs, logger, () => throwKnownOutcomeForLocatorMiss(step, inputs)), value);
      return ownership;
    }
    case "wait": {
      await surface.wait(readWaitMilliseconds(step));
      return ownership;
    }
    case "extract": {
      const text = await surface.extractText(await resolveLocator(surface, step, inputs, logger, () => throwKnownOutcomeForLocatorMiss(step, inputs)));
      for (const outputName of Object.values(step.outputBindings)) {
        outputs[outputName] = text;
      }
      return ownership;
    }
    case "checkpoint": {
      await assertCheckpoint(artifact, surface, outputs);
      return ownership;
    }
    case "handoff": {
      ownership = await requestHumanHandoff({
        artifact,
        step,
        surface,
        logger,
        handoff: args.handoff,
        evidenceDir: args.evidenceDir,
        evidenceStore: args.evidenceStore,
        redactor: args.redactor,
        ownership,
        reason: "artifact_requested_handoff",
        expected: "Human intervention and resume signal"
      });
      return ownership;
    }
  }
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
