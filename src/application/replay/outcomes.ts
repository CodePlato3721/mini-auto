import type { CapabilityArtifact, CapabilityStep } from "../../domain/contracts.js";
import type { BrowserSurface } from "../ports/browser-surface.js";
import { ReplayOutcomeError, ReplayStepError } from "./errors.js";

export async function assertKnownBusinessOutcome(
  artifact: CapabilityArtifact,
  step: CapabilityStep,
  surface: BrowserSurface
): Promise<void> {
  if (!isLoginStep(step)) {
    return;
  }

  const currentUrl = await surface.currentUrl();
  const text = await surface.visibleText();
  const stillOnLogin = artifact.policy.allowedRoutes.includes("/") && currentUrl.endsWith("/");
  if (stillOnLogin && /username and password do not match|epic sadface|locked out/i.test(text)) {
    throw new ReplayOutcomeError(step.id, "invalid_login", text);
  }
}

export function throwKnownOutcomeForLocatorMiss(step: CapabilityStep, inputs: Record<string, unknown>): void {
  if (!isProductSelectionStep(step)) {
    return;
  }

  const productName = typeof inputs.productName === "string" ? inputs.productName : "requested product";
  throw new ReplayOutcomeError(
    step.id,
    "product_not_found",
    `Could not find an actionable control for product: ${productName}`
  );
}

export function isLoginStep(step: CapabilityStep): boolean {
  return step.action === "click" && /login|submit/i.test(`${step.id} ${step.description}`);
}

export function isProductSelectionStep(step: CapabilityStep): boolean {
  return /product|add.*cart/i.test(`${step.id} ${step.description}`);
}

export async function assertCheckpoint(
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
