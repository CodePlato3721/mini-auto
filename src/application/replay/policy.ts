import type { CapabilityArtifact, CapabilityStep } from "../../domain/contracts.js";
import type { EvidenceLog, EvidenceStore } from "../evidence.js";
import type { BrowserSurface } from "../ports/browser-surface.js";
import type { AutomationOwnership, HumanHandoffController } from "../ports/human-handoff.js";
import { ReplayStepError } from "./errors.js";
import { requestHumanHandoff } from "./handoff.js";

export async function ensureStepAllowed(args: {
  artifact: CapabilityArtifact;
  step: CapabilityStep;
  surface: BrowserSurface;
  logger: EvidenceLog;
  handoff?: HumanHandoffController;
  evidenceDir: string;
  evidenceStore: EvidenceStore;
  redactor: (value: string) => string;
  ownership: AutomationOwnership;
}): Promise<AutomationOwnership> {
  const { artifact, step } = args;
  if (!artifact.policy.allowedActions.includes(step.action)) {
    throw new ReplayStepError(step.id, "Allowed action in policy", `Action ${step.action} is not allowed`);
  }

  if (step.risk !== "safe" && artifact.policy.riskyActionHandling !== "require_handoff") {
    throw new ReplayStepError(
      step.id,
      "Safe or explicitly handled action",
      `Action risk ${step.risk} requires ${artifact.policy.riskyActionHandling}`
    );
  }

  if (step.risk !== "safe") {
    return await requestHumanHandoff({
      ...args,
      reason: `unsafe_${step.risk}_action`,
      expected: `Human review before ${step.action}`
    });
  }

  return args.ownership;
}

export function assertAllowedUrl(artifact: CapabilityArtifact, step: CapabilityStep, value: string): void {
  const url = new URL(value);
  assertUrlAllowed(artifact, step, url);
}

export async function assertCurrentRouteAllowed(
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
