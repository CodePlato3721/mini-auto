import type { LocatorCandidate } from "../../domain/contracts.js";

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
  handoffAttachment?(): Promise<string[]>;
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

export type FailureEvidenceContext = {
  evidenceDir: string;
  artifactId: string;
  stepId: string;
  redact: (value: string) => string;
};
