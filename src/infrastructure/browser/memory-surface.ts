import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  BrowserSurface,
  FailureEvidenceContext
} from "../../application/ports/browser-surface.js";
import type { LocatorCandidate } from "../../domain/contracts.js";

export type MemorySurfaceOptions = {
  initialUrl?: string;
  finalUrl?: string;
  visibleText?: string;
  locators?: Record<string, string>;
  unavailableUntilAttempt?: Record<string, number>;
};

export type MemoryCall = {
  type: "navigate" | "click" | "type" | "wait" | "extract" | "checkpoint" | "human";
  stepId?: string;
  locator?: string;
  value?: string;
};

export type MemorySurface = BrowserSurface & {
  calls: MemoryCall[];
};

export function createMemorySurface(options: MemorySurfaceOptions = {}): MemorySurface {
  let url = options.initialUrl ?? "about:blank";
  const visibleText = options.visibleText ?? "";
  const locators = options.locators ?? {};
  const locatorAttempts = new Map<string, number>();
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
      const key = locatorKey(candidate);
      const attempts = (locatorAttempts.get(key) ?? 0) + 1;
      locatorAttempts.set(key, attempts);
      const unavailableUntilAttempt = options.unavailableUntilAttempt?.[key] ?? 0;
      return key in locators && attempts > unavailableUntilAttempt;
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
    async captureFailureEvidence(context: FailureEvidenceContext) {
      const snapshotPath = path.resolve(context.evidenceDir, `${context.artifactId}-${context.stepId}-snapshot.txt`);
      await mkdir(path.dirname(snapshotPath), { recursive: true });
      await writeFile(snapshotPath, context.redact(`URL: ${url}\n\n${visibleText}\n`), "utf8");
      return [snapshotPath];
    },
    async close() {
      return;
    }
  };
}

function locatorKey(candidate: LocatorCandidate): string {
  return `${candidate.strategy}:${candidate.value}`;
}

export type { BrowserSurface };
