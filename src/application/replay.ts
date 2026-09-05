import {
  hardFailureReplayResult,
  knownBusinessOutcomeReplayResult,
  parseCapabilityArtifact,
  redactInvocationInputs,
  successReplayResult,
  type CapabilityArtifact,
  type CapabilityArtifactInput,
  type ReplayResult
} from "../domain/contracts.js";
import type { EvidenceStore } from "./evidence.js";
import type { BrowserSurface } from "./ports/browser-surface.js";
import type { AutomationOwnership, HumanHandoffController } from "./ports/human-handoff.js";
import { ReplayOutcomeError, ReplayStepError } from "./replay/errors.js";
import { assertCheckpoint, assertKnownBusinessOutcome } from "./replay/outcomes.js";
import { assertCurrentRouteAllowed } from "./replay/policy.js";
import { createRedactor } from "./replay/redaction.js";
import { executeStepWithStuckHandoff } from "./replay/step-execution.js";

export type ReplayOptions = {
  artifactInput: unknown;
  inputs: Record<string, unknown>;
  evidenceDir: string;
  evidenceStore: EvidenceStore;
  surface?: BrowserSurface;
  surfaceFactory?: () => Promise<BrowserSurface>;
  handoff?: HumanHandoffController;
};

export type ReplayFromFileOptions = Omit<ReplayOptions, "artifactInput"> & {
  artifactPath: string;
};

export async function replayCapabilityFromFile(options: ReplayFromFileOptions): Promise<ReplayResult> {
  return replayCapability({
    ...options,
    artifactInput: await options.evidenceStore.readJsonFile(options.artifactPath)
  });
}

export async function replayCapability(options: ReplayOptions): Promise<ReplayResult> {
  const logger = options.evidenceStore.createReplayLog(options.evidenceDir);
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

  const surface = options.surface ?? (options.surfaceFactory ? await options.surfaceFactory() : undefined);

  if (!surface) {
    const result = hardFailureReplayResult({
      artifactId: artifact.metadata.id,
      stepId: "browser.surface",
      expected: "Browser surface",
      observed: "No browser surface was provided",
      evidence: [logger.path]
    });
    logger.append("replay.failed", { result });
    await logger.flush();
    return result;
  }
  const outputs: Record<string, unknown> = {};
  const redactor = createRedactor(artifact, options.inputs);
  let ownership: AutomationOwnership = "automation";

  logger.append("replay.started", {
    artifactId: artifact.metadata.id,
    schemaVersion: artifact.schemaVersion,
    stepCount: artifact.steps.length,
    inputs: redactInvocationInputs(artifact, options.inputs)
  });

  try {
    for (let stepIndex = 0; stepIndex < artifact.steps.length; stepIndex += 1) {
      const step = artifact.steps[stepIndex];
      logger.append("step.started", {
        artifactId: artifact.metadata.id,
        stepId: step.id,
        action: step.action,
        risk: step.risk
      });

      logger.append("ownership.state", {
        artifactId: artifact.metadata.id,
        stepId: step.id,
        owner: ownership
      });

      const execution = await executeStepWithStuckHandoff({
        artifact,
        step,
        stepIndex,
        inputs: options.inputs,
        outputs,
        surface,
        logger,
        handoff: options.handoff,
        evidenceDir: options.evidenceDir,
        evidenceStore: options.evidenceStore,
        redactor,
        ownership
      });
      ownership = execution.ownership;
      if (!execution.completed) {
        if (execution.nextStepIndex !== undefined) {
          stepIndex = execution.nextStepIndex - 1;
        }
        continue;
      }
      await assertKnownBusinessOutcome(artifact, step, surface);
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
    if (error instanceof ReplayOutcomeError) {
      const result = knownBusinessOutcomeReplayResult({
        artifactId: artifact.metadata.id,
        outcome: error.outcome,
        stepId,
        observed: redactor(error.message),
        evidence: [logger.path]
      });
      logger.append("replay.completed", { result });
      await logger.flush();
      return result;
    }

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
