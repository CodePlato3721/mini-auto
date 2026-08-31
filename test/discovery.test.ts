import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { parseCapabilityArtifact } from "../src/contracts.js";
import { discoverCapability, type DecisionEngine } from "../src/discovery.js";
import { createMemorySurface } from "../src/replay.js";

const tempDirs: string[] = [];

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

  it("rejects malformed model decisions before acting", async () => {
    const surface = createMemorySurface();
    const result = await discoverCapability({
      goal: "Do something unsafe",
      targetUrl: "https://www.saucedemo.com/",
      inputs: {},
      evidenceDir: await tempEvidenceDir(),
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
  });

  it("rejects unsafe structured model decisions before acting", async () => {
    const surface = createMemorySurface();
    const result = await discoverCapability({
      goal: "Leave the allowed target",
      targetUrl: "https://www.saucedemo.com/",
      inputs: {},
      evidenceDir: await tempEvidenceDir(),
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
