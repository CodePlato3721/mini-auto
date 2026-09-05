import type { BrowserSurface } from "./browser-surface.js";

export type AutomationOwnership = "automation" | "human" | "resumed_automation";

export type HumanInterventionRequest = {
  id: string;
  artifactId: string;
  goal: string;
  stepId: string;
  reason: string;
  expected: string;
  observed: string;
  evidence: string[];
  attachment?: string[];
};

export type HumanHandoffActivity = {
  description: string;
  observed?: string;
};

export type HumanHandoffResume =
  | {
      signal: "resume";
      activities?: HumanHandoffActivity[];
    }
  | {
      signal: "fail";
      reason: string;
      activities?: HumanHandoffActivity[];
    };

export type HumanHandoffContext = {
  request: HumanInterventionRequest;
  surface: BrowserSurface;
  ownership: AutomationOwnership;
};

export type HumanHandoffController = {
  waitForResume(context: HumanHandoffContext): Promise<HumanHandoffResume>;
};
