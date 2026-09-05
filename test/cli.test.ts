import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/interfaces/cli.js";
import type { DecisionEngine } from "../src/application/discovery.js";
import type { HumanHandoffController } from "../src/application/ports/human-handoff.js";
import { createMemorySurface } from "../src/infrastructure/browser/memory-surface.js";

const tempDirs: string[] = [];

async function tempEvidenceDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mini-auto-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("CLI scaffold", () => {
  it("prints typed help for discovery and replay flows", async () => {
    const { result, stdout, exitCode } = await runCli(["--help"], {});

    expect(exitCode).toBe(0);
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(stdout);
    expect(parsed.message).toContain("mini-auto discover --goal <text> --target-url <url>");
    expect(parsed.message).toContain("mini-auto replay --artifact <path> [--goal <text>]");
    expect(parsed.message).toContain("mini-auto replay-only --artifact <path> [--goal <text>]");
    expect(parsed.message).toContain("MINI_AUTO_PASSWORD");
    expect(parsed.message).not.toContain("[--json]");
    expect(parsed.message).not.toContain("[--human-handoff]");
  });

  it("returns structured configuration errors instead of throwing", async () => {
    const { result, stdout, exitCode } = await runCli(["discover"], {});

    expect(exitCode).toBe(1);
    expect(result.kind).toBe("configuration_error");
    expect(result.errors).toContain("Missing required flag: --goal <text>");
    expect(result.errors).toContain("Missing required flag: --target-url <url>");
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, kind: "configuration_error" });
  });

  it("runs discovery through a structured decision engine and returns the artifact path", async () => {
    const evidenceDir = await tempEvidenceDir();
    const inputsPath = path.join(evidenceDir, "inputs.json");
    await writeFile(inputsPath, JSON.stringify({ username: "standard_user", password: "secret_sauce" }), "utf8");
    const decisionEngine: DecisionEngine = {
      async decide(_observation, context) {
        if (context.stepNumber === 1) {
          return {
            action: "navigate",
            description: "Open target.",
            target: { locatorCandidates: [{ strategy: "url", value: context.targetUrl }] },
            risk: "safe"
          };
        }
        return { complete: true };
      }
    };

    const { result, stdout, exitCode } = await runCli(
      ["discover", "--goal", "Open Sauce Demo", "--target-url", "https://www.saucedemo.com/", "--inputs-file", inputsPath],
      { MINI_AUTO_EVIDENCE_DIR: evidenceDir, MINI_AUTO_MODEL_API_KEY: "test-key" },
      {
        decisionEngine,
        discoverySurface: createMemorySurface({ visibleText: "Ready" })
      }
    );

    expect(exitCode).toBe(0);
    expect(result.ok).toBe(true);
    expect(JSON.parse(stdout)).toMatchObject({
      ok: true,
      command: "discover",
      data: {
        discovery: {
          kind: "success"
        }
      }
    });
  });

  it("validates a replay-only command and returns machine-readable output", async () => {
    const evidenceDir = await tempEvidenceDir();
    const artifactPath = path.join(evidenceDir, "artifact.json");
    const inputsPath = path.join(evidenceDir, "inputs.json");
    await writeFile(
      artifactPath,
      JSON.stringify({
        schemaVersion: "1.0.0",
        metadata: {
          id: "cli-smoke",
          name: "CLI Smoke",
          createdAt: "2026-08-31T00:00:00.000Z"
        },
        inputs: [{ name: "username", type: "string", required: true }],
        outputs: [{ name: "resultKind", type: "string", required: true }],
        policy: {
          allowedDomains: ["www.saucedemo.com"],
          allowedRoutes: ["/"],
          allowedActions: ["navigate", "checkpoint"]
        },
        steps: [
          {
            id: "open",
            action: "navigate",
            description: "Open target.",
            target: {
              locatorCandidates: [{ strategy: "url", value: "https://www.saucedemo.com/" }]
            },
            risk: "safe"
          },
          {
            id: "done",
            action: "checkpoint",
            description: "Verify target.",
            risk: "safe"
          }
        ],
        successCheckpoint: {
          id: "complete",
          urlIncludes: "saucedemo.com",
          textIncludes: ["Ready"],
          outputAssertions: { resultKind: "success" }
        }
      }),
      "utf8"
    );
    await writeFile(inputsPath, JSON.stringify({ username: "standard_user" }), "utf8");

    const { result, stdout, exitCode } = await runCli(
      ["replay-only", "--artifact", artifactPath, "--inputs-file", inputsPath],
      { MINI_AUTO_EVIDENCE_DIR: evidenceDir },
      {
        replaySurface: createMemorySurface({
          visibleText: "Ready"
        })
      }
    );

    expect(exitCode).toBe(0);
    expect(result.ok).toBe(true);
    expect(JSON.parse(stdout)).toMatchObject({
      ok: true,
      command: "replay-only",
      data: {
        replay: {
          kind: "success",
          artifactId: "cli-smoke",
          outputs: {
            resultKind: "success"
          }
        }
      }
    });
  });

  it("fills username and productName from --goal and password from MINI_AUTO_PASSWORD", async () => {
    const evidenceDir = await tempEvidenceDir();
    const artifactPath = path.join(evidenceDir, "artifact.json");
    const inputsPath = path.join(evidenceDir, "inputs.json");
    await writeFile(
      artifactPath,
      JSON.stringify({
        schemaVersion: "1.0.0",
        metadata: {
          id: "cli-input-fallbacks",
          name: "CLI Input Fallbacks",
          createdAt: "2026-09-01T00:00:00.000Z"
        },
        inputs: [
          { name: "username", type: "string", required: true },
          { name: "password", type: "string", required: true, sensitive: true },
          { name: "productName", type: "string", required: true }
        ],
        outputs: [{ name: "resultKind", type: "string", required: true }],
        policy: {
          allowedDomains: ["www.saucedemo.com"],
          allowedRoutes: ["/", "/checkout-complete.html"],
          allowedActions: ["navigate", "type", "click", "checkpoint"]
        },
        steps: [
          {
            id: "open",
            action: "navigate",
            description: "Open target.",
            target: {
              locatorCandidates: [{ strategy: "url", value: "https://www.saucedemo.com/" }]
            },
            risk: "safe"
          },
          {
            id: "enter-username",
            action: "type",
            description: "Enter username.",
            target: { locatorCandidates: [{ strategy: "testId", value: "username" }] },
            inputBindings: { value: "username" },
            risk: "safe"
          },
          {
            id: "enter-password",
            action: "type",
            description: "Enter password.",
            target: { locatorCandidates: [{ strategy: "testId", value: "password" }] },
            inputBindings: { value: "password" },
            risk: "safe"
          },
          {
            id: "add-product",
            action: "click",
            description: "Add product.",
            target: { locatorCandidates: [{ strategy: "relativeText", value: "{{productName}} >> Add to cart" }] },
            risk: "safe"
          },
          {
            id: "done",
            action: "checkpoint",
            description: "Verify target.",
            risk: "safe"
          }
        ],
        successCheckpoint: {
          id: "complete",
          urlIncludes: "/checkout-complete.html",
          textIncludes: ["Ready"],
          outputAssertions: { resultKind: "success" }
        }
      }),
      "utf8"
    );
    await writeFile(inputsPath, JSON.stringify({}), "utf8");
    const surface = createMemorySurface({
      finalUrl: "https://www.saucedemo.com/checkout-complete.html",
      visibleText: "Ready",
      locators: {
        "testId:username": "",
        "testId:password": "",
        "relativeText:Sauce Labs Backpack >> Add to cart": ""
      }
    });

    const { result, stdout, exitCode } = await runCli(
      [
        "replay-only",
        "--artifact",
        artifactPath,
        "--goal",
        "Log in as standard_user and add Sauce Labs Backpack to the cart.",
        "--inputs-file",
        inputsPath
      ],
      { MINI_AUTO_EVIDENCE_DIR: evidenceDir, MINI_AUTO_PASSWORD: "secret_sauce" },
      { replaySurface: surface }
    );

    expect(exitCode).toBe(0);
    expect(result.ok).toBe(true);
    expect(surface.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "type", value: "standard_user" }),
        expect.objectContaining({ type: "type", value: "secret_sauce" }),
        expect.objectContaining({ type: "click", locator: "relativeText:Sauce Labs Backpack >> Add to cart" })
      ])
    );
    expect(stdout).not.toContain("standard_user");
    expect(stdout).not.toContain("secret_sauce");
  });

  it("returns a structured configuration error when the artifact file is missing", async () => {
    const evidenceDir = await tempEvidenceDir();
    const { result, stdout, exitCode } = await runCli(
      ["replay", "--artifact", path.join(evidenceDir, "missing.json")],
      { MINI_AUTO_EVIDENCE_DIR: evidenceDir }
    );

    expect(exitCode).toBe(1);
    expect(result.kind).toBe("configuration_error");
    expect(JSON.parse(stdout)).toMatchObject({
      ok: false,
      kind: "configuration_error",
      command: "replay"
    });
  });

  it("passes human handoff control through replay by default", async () => {
    const evidenceDir = await tempEvidenceDir();
    const artifactPath = path.join(evidenceDir, "handoff-artifact.json");
    await writeFile(
      artifactPath,
      JSON.stringify({
        schemaVersion: "1.0.0",
        metadata: {
          id: "cli-handoff",
          name: "CLI Handoff",
          createdAt: "2026-08-31T00:00:00.000Z"
        },
        inputs: [{ name: "username", type: "string", required: true }],
        outputs: [{ name: "resultKind", type: "string", required: true }],
        policy: {
          allowedDomains: ["www.saucedemo.com"],
          allowedRoutes: ["/"],
          allowedActions: ["navigate", "handoff", "checkpoint"]
        },
        steps: [
          {
            id: "open",
            action: "navigate",
            description: "Open target.",
            target: {
              locatorCandidates: [{ strategy: "url", value: "https://www.saucedemo.com/" }]
            },
            risk: "safe"
          },
          {
            id: "manual",
            action: "handoff",
            description: "Let a human inspect the live session.",
            risk: "safe"
          },
          {
            id: "done",
            action: "checkpoint",
            description: "Verify target.",
            risk: "safe"
          }
        ],
        successCheckpoint: {
          id: "complete",
          urlIncludes: "saucedemo.com",
          textIncludes: ["Ready"],
          outputAssertions: { resultKind: "success" }
        }
      }),
      "utf8"
    );
    let handoffStepId: string | undefined;
    const handoffController: HumanHandoffController = {
      async waitForResume(context) {
        handoffStepId = context.request.stepId;
        return { signal: "resume", activities: [{ description: "Human resumed from CLI test." }] };
      }
    };

    const { result, stdout, exitCode } = await runCli(
      ["replay", "--artifact", artifactPath, "--inputs-json", "{\"username\":\"standard_user\"}"],
      { MINI_AUTO_EVIDENCE_DIR: evidenceDir },
      {
        replaySurface: createMemorySurface({
          visibleText: "Ready"
        }),
        handoffController
      }
    );

    expect(exitCode).toBe(0);
    expect(handoffStepId).toBe("manual");
    expect(result.ok).toBe(true);
    expect(JSON.parse(stdout)).toMatchObject({
      ok: true,
      command: "replay",
      data: {
        replay: {
          kind: "success",
          artifactId: "cli-handoff"
        }
      }
    });
  });
});
