import type { CapabilityStep, LocatorCandidate } from "../../domain/contracts.js";
import type { EvidenceLog } from "../evidence.js";
import type { BrowserSurface, ResolvedLocator } from "../ports/browser-surface.js";
import { ReplayStepError } from "./errors.js";

export async function resolveLocator(
  surface: BrowserSurface,
  step: CapabilityStep,
  inputs: Record<string, unknown>,
  logger: EvidenceLog,
  onLocatorMiss?: () => void
): Promise<ResolvedLocator> {
  if (!step.target) {
    throw new ReplayStepError(step.id, "Step target with locator candidates", "No target was declared");
  }

  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    for (const rawCandidate of step.target.locatorCandidates) {
      const candidate = interpolateLocator(rawCandidate, inputs);
      if (await surface.hasLocator(candidate)) {
        if (attempt > 1) {
          logger.append("step.recovered", {
            stepId: step.id,
            condition: "locator_not_ready",
            recovery: "bounded_locator_retry",
            attempts: attempt
          });
        }
        return {
          candidate,
          key: locatorKey(candidate),
          stepId: step.id
        };
      }
    }

    if (attempt < attempts) {
      logger.append("step.retrying", {
        stepId: step.id,
        condition: "locator_not_ready",
        recovery: "bounded_locator_retry",
        attempt
      });
      await surface.wait(250);
    }
  }

  onLocatorMiss?.();
  throw new ReplayStepError(
    step.id,
    "At least one locator candidate should resolve",
    `No locator candidate matched: ${step.target.locatorCandidates.map(locatorKey).join(", ")}`
  );
}

export function firstLocator(step: CapabilityStep, strategy: LocatorCandidate["strategy"]): LocatorCandidate {
  const locator = step.target?.locatorCandidates.find((candidate) => candidate.strategy === strategy);
  if (!locator) {
    throw new ReplayStepError(step.id, `${strategy} locator candidate`, "No matching locator was declared");
  }
  return locator;
}

export function locatorKey(candidate: LocatorCandidate): string {
  return `${candidate.strategy}:${candidate.value}`;
}

export function interpolateLocator(candidate: LocatorCandidate, inputs: Record<string, unknown>): LocatorCandidate {
  return {
    ...candidate,
    value: interpolate(candidate.value, inputs),
    name: candidate.name ? interpolate(candidate.name, inputs) : undefined
  };
}

export function interpolate(value: string, inputs: Record<string, unknown>): string {
  return value.replace(/\{\{([a-zA-Z0-9_-]+)\}\}/g, (_, name: string) => {
    const input = inputs[name];
    return input === undefined || input === null ? "" : String(input);
  });
}
