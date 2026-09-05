import type { CapabilityArtifact, CapabilityStep } from "../../domain/contracts.js";
import type { EvidenceLog, EvidenceStore } from "../evidence.js";
import type { BrowserSurface } from "../ports/browser-surface.js";
import type {
  AutomationOwnership,
  HumanHandoffController,
  HumanInterventionRequest
} from "../ports/human-handoff.js";
import { ReplayStepError } from "./errors.js";

export async function requestHumanHandoff(args: {
  artifact: CapabilityArtifact;
  step: CapabilityStep;
  surface: BrowserSurface;
  logger: EvidenceLog;
  handoff?: HumanHandoffController;
  evidenceDir: string;
  evidenceStore: EvidenceStore;
  redactor: (value: string) => string;
  ownership: AutomationOwnership;
  reason: string;
  expected: string;
}): Promise<AutomationOwnership> {
  if (!args.handoff) {
    throw new ReplayStepError(
      args.step.id,
      "Human handoff controller",
      `Step requires human handoff: ${args.reason}`
    );
  }

  const evidence = await captureInterventionEvidence(args);
  const attachment = await args.surface.handoffAttachment?.();
  const request: HumanInterventionRequest = {
    id: `${args.artifact.metadata.id}:${args.step.id}:${Date.now()}`,
    artifactId: args.artifact.metadata.id,
    goal: args.artifact.metadata.description ?? args.artifact.metadata.name,
    stepId: args.step.id,
    reason: args.reason,
    expected: args.expected,
    observed: args.redactor(await describeSurface(args.surface)),
    evidence,
    attachment
  };

  args.logger.append("ownership.changed", {
    artifactId: args.artifact.metadata.id,
    stepId: args.step.id,
    from: args.ownership,
    to: "human"
  });
  args.logger.append("handoff.requested", request);

  const resume = await args.handoff.waitForResume({
    request,
    surface: args.surface,
    ownership: "human"
  });

  for (const activity of resume.activities ?? []) {
    args.logger.append("handoff.human_activity", {
      artifactId: args.artifact.metadata.id,
      stepId: args.step.id,
      description: activity.description,
      observed: activity.observed ? args.redactor(activity.observed) : undefined
    });
  }

  if (resume.signal === "fail") {
    args.logger.append("handoff.failed", {
      artifactId: args.artifact.metadata.id,
      stepId: args.step.id,
      reason: args.redactor(resume.reason)
    });
    throw new ReplayStepError(
      args.step.id,
      "Human intervention resolved stuck replay state",
      `Operator could not resolve handoff: ${args.redactor(resume.reason)}`
    );
  }

  args.logger.append("ownership.changed", {
    artifactId: args.artifact.metadata.id,
    stepId: args.step.id,
    from: "human",
    to: "resumed_automation"
  });
  args.logger.append("handoff.resumed", {
    artifactId: args.artifact.metadata.id,
    stepId: args.step.id
  });

  return "resumed_automation";
}

async function captureInterventionEvidence(args: {
  artifact: CapabilityArtifact;
  step: CapabilityStep;
  surface: BrowserSurface;
  evidenceDir: string;
  evidenceStore: EvidenceStore;
  redactor: (value: string) => string;
}): Promise<string[]> {
  const snapshotPath = await args.evidenceStore.writeTextEvidence(
    args.evidenceDir,
    `${args.artifact.metadata.id}-${args.step.id}-handoff.txt`,
    args.redactor(await describeSurface(args.surface))
  );
  return [snapshotPath];
}

async function describeSurface(surface: BrowserSurface): Promise<string> {
  const [currentUrl, visibleText] = await Promise.all([surface.currentUrl(), surface.visibleText()]);
  return `URL: ${currentUrl}\n\n${visibleText}`;
}
