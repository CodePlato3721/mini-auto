import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { discoverCapability, type DecisionEngine } from "../src/application/discovery.js";
import { parseCapabilityArtifact } from "../src/domain/contracts.js";
import { createMemorySurface } from "../src/infrastructure/browser/memory-surface.js";
import { createFileEvidenceStore } from "../src/infrastructure/evidence/file-evidence-store.js";

const tempDirs: string[] = [];
const evidenceStore = createFileEvidenceStore();

async function tempEvidenceDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mini-auto-discovery-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("LLM-driven discovery", () => {
  it("observes, accepts structured decisions, records successful actions, and emits a replayable artifact", async () => {
    const evidenceDir = await tempEvidenceDir();
    const engine = scriptedDecisionEngine([
      {
        action: "navigate",
        description: "Open Sauce Demo.",
        target: { locatorCandidates: [{ strategy: "url", value: "https://www.saucedemo.com/" }] },
        risk: "safe"
      },
      {
        action: "type",
        description: "Enter username.",
        target: { locatorCandidates: [{ strategy: "testId", value: "username" }] },
        inputBindings: { value: "username" },
        risk: "safe"
      },
      {
        action: "click",
        description: "Submit login.",
        target: { locatorCandidates: [{ strategy: "testId", value: "login-button" }] },
        risk: "safe"
      },
      {
        action: "extract",
        description: "Read confirmation.",
        target: { locatorCandidates: [{ strategy: "testId", value: "complete-header" }] },
        outputBindings: { text: "confirmationMessage" },
        risk: "safe"
      },
      {
        action: "checkpoint",
        description: "Confirm completion.",
        risk: "safe"
      }
    ]);
    const surface = createMemorySurface({
      finalUrl: "https://www.saucedemo.com/checkout-complete.html",
      visibleText: "Thank you for your order!",
      locators: {
        "testId:username": "",
        "testId:login-button": "",
        "testId:complete-header": "Thank you for your order!"
      }
    });

    const result = await discoverCapability({
      goal: "Log in to Sauce Demo and verify checkout completion",
      targetUrl: "https://www.saucedemo.com/",
      inputs: { username: "standard_user", password: "secret_sauce" },
      evidenceDir,
      evidenceStore,
      decisionEngine: engine,
      surface
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }

    const artifact = JSON.parse(await readFile(result.artifactPath, "utf8")) as unknown;
    const parsed = parseCapabilityArtifact(artifact);
    expect(parsed.ok).toBe(true);
    expect(parsed.artifact?.metadata.source).toBe("llm-discovery");
    expect(parsed.artifact?.policy.riskyActionHandling).toBe("require_handoff");
    expect(parsed.artifact?.steps.map((step) => step.id)).toEqual([
      "step-001",
      "step-002",
      "step-003",
      "step-004",
      "step-005"
    ]);
    expect(surface.calls.map((call) => call.type)).toEqual(["navigate", "type", "click", "extract"]);

    const evidence = await readFile(result.evidence[0], "utf8");
    expect(evidence).toContain('"event":"discovery.observed"');
    expect(evidence).toContain('"event":"decision.accepted"');
    expect(evidence).toContain('"event":"artifact.written"');
    expect(evidence).toContain('"password":"[REDACTED]"');
    expect(evidence).not.toContain("secret_sauce");
  });

  it("records risky discovery actions into the artifact instead of stopping discovery", async () => {
    const evidenceDir = await tempEvidenceDir();
    const result = await discoverCapability({
      goal: "Finish a demo checkout",
      targetUrl: "https://www.saucedemo.com/",
      inputs: { approvalContext: "demo" },
      evidenceDir,
      evidenceStore,
      decisionEngine: scriptedDecisionEngine([
        {
          action: "click",
          description: "Finish checkout.",
          target: { locatorCandidates: [{ strategy: "testId", value: "finish" }] },
          risk: "risky"
        },
        { complete: true }
      ]),
      surface: createMemorySurface({
        finalUrl: "https://www.saucedemo.com/checkout-complete.html",
        visibleText: "Thank you for your order!",
        locators: {
          "testId:finish": ""
        }
      })
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }
    const artifact = JSON.parse(await readFile(result.artifactPath, "utf8")) as unknown;
    const parsed = parseCapabilityArtifact(artifact);
    expect(parsed.ok).toBe(true);
    expect(parsed.artifact?.steps[0]).toMatchObject({
      action: "click",
      description: "Finish checkout.",
      risk: "risky"
    });
  });

  it("normalizes discovery risk labels for login and final checkout clicks", async () => {
    const evidenceDir = await tempEvidenceDir();
    const result = await discoverCapability({
      goal: "Log in and finish a demo checkout",
      targetUrl: "https://www.saucedemo.com/",
      inputs: { username: "standard_user", password: "secret_sauce" },
      evidenceDir,
      evidenceStore,
      decisionEngine: scriptedDecisionEngine([
        {
          action: "click",
          description: "Click the login button to sign in.",
          target: { locatorCandidates: [{ strategy: "testId", value: "login-button" }] },
          risk: "risky"
        },
        {
          action: "click",
          description: "Click the Finish button to complete the checkout.",
          target: { locatorCandidates: [{ strategy: "testId", value: "finish" }] },
          risk: "safe"
        },
        { complete: true }
      ]),
      surface: createMemorySurface({
        finalUrl: "https://www.saucedemo.com/checkout-complete.html",
        visibleText: "Thank you for your order!",
        locators: {
          "testId:login-button": "Login",
          "testId:finish": "Finish"
        }
      })
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }

    const artifact = JSON.parse(await readFile(result.artifactPath, "utf8")) as unknown;
    const parsed = parseCapabilityArtifact(artifact);
    expect(parsed.ok).toBe(true);
    expect(parsed.artifact?.steps.map((step) => step.risk)).toEqual(["safe", "risky"]);
  });

  it("rejects malformed model decisions before acting", async () => {
    const surface = createMemorySurface();
    const evidenceDir = await tempEvidenceDir();
    const result = await discoverCapability({
      goal: "Do something unsafe",
      targetUrl: "https://www.saucedemo.com/",
      inputs: {},
      evidenceDir,
      evidenceStore,
      decisionEngine: {
        async decide() {
          return { action: "open_everything" };
        }
      },
      surface
    });

    expect(result).toMatchObject({
      ok: false,
      kind: "hard_failure"
    });
    expect(surface.calls).toEqual([]);
    const evidence = await readFile(result.evidence[0], "utf8");
    expect(evidence).toContain('"event":"decision.proposed"');
    expect(evidence).toContain('"action":"open_everything"');
    if (result.ok) {
      throw new Error("Expected malformed decision to fail.");
    }
    expect(result.observed).toContain("<root>");
  });

  it("rejects unsafe structured model decisions before acting", async () => {
    const surface = createMemorySurface();
    const result = await discoverCapability({
      goal: "Leave the allowed target",
      targetUrl: "https://www.saucedemo.com/",
      inputs: {},
      evidenceDir: await tempEvidenceDir(),
      evidenceStore,
      decisionEngine: {
        async decide() {
          return {
            action: "navigate",
            description: "Navigate away.",
            target: { locatorCandidates: [{ strategy: "url", value: "https://evil.example/" }] },
            risk: "safe"
          };
        }
      },
      surface
    });

    expect(result).toMatchObject({
      ok: false,
      kind: "hard_failure",
      expected: "Allowed discovery URL"
    });
    expect(surface.calls).toEqual([]);
  });

  it("fails instead of publishing an artifact when discovery never completes", async () => {
    const result = await discoverCapability({
      goal: "Loop forever",
      targetUrl: "https://www.saucedemo.com/",
      inputs: {},
      evidenceDir: await tempEvidenceDir(),
      evidenceStore,
      maxSteps: 1,
      decisionEngine: {
        async decide() {
          return {
            action: "navigate",
            description: "Open target.",
            target: { locatorCandidates: [{ strategy: "url", value: "https://www.saucedemo.com/" }] },
            risk: "safe"
          };
        }
      },
      surface: createMemorySurface({ visibleText: "Ready" })
    });

    expect(result).toMatchObject({
      ok: false,
      kind: "hard_failure",
      expected: "Goal completion within max steps"
    });
  });
});

function scriptedDecisionEngine(decisions: unknown[]): DecisionEngine {
  return {
    async decide() {
      const decision = decisions.shift();
      if (!decision) {
        return { complete: true };
      }
      return decision;
    }
  };
}
