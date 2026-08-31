import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { CapabilityArtifactInput } from "../src/contracts.js";
import { createMemorySurface, replayCapability } from "../src/replay.js";

const tempDirs: string[] = [];

async function tempEvidenceDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mini-auto-replay-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function checkoutArtifact(): CapabilityArtifactInput {
  return {
    schemaVersion: "1.0.0",
    metadata: {
      id: "sauce-demo-checkout",
      name: "Sauce Demo Checkout",
      createdAt: "2026-08-31T00:00:00.000Z"
    },
    inputs: [
      { name: "username", type: "string", required: true },
      { name: "password", type: "string", required: true, sensitive: true },
      { name: "productName", type: "string", required: true },
      { name: "firstName", type: "string", required: true },
      { name: "lastName", type: "string", required: true },
      { name: "postalCode", type: "string", required: true }
    ],
    outputs: [
      { name: "confirmationMessage", type: "string", required: true },
      { name: "orderedItem", type: "string", required: true },
      { name: "totalPrice", type: "currency", required: true },
      { name: "resultKind", type: "string", required: true }
    ],
    policy: {
      allowedDomains: ["www.saucedemo.com"],
      allowedRoutes: ["/", "/inventory.html", "/cart.html", "/checkout-step-one.html", "/checkout-step-two.html", "/checkout-complete.html"],
      allowedActions: ["navigate", "click", "type", "wait", "extract", "checkpoint"]
    },
    steps: [
      {
        id: "open-login",
        action: "navigate",
        description: "Open Sauce Demo.",
        target: { locatorCandidates: [{ strategy: "url", value: "https://www.saucedemo.com/" }] },
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
        id: "login",
        action: "click",
        description: "Submit login.",
        target: { locatorCandidates: [{ strategy: "testId", value: "login-button" }] },
        risk: "safe"
      },
      {
        id: "add-product",
        action: "click",
        description: "Add the selected product.",
        target: {
          locatorCandidates: [
            { strategy: "testId", value: "missing-primary" },
            { strategy: "relativeText", value: "Sauce Labs Backpack >> Add to cart" }
          ]
        },
        risk: "safe"
      },
      {
        id: "extract-item",
        action: "extract",
        description: "Extract ordered item.",
        target: { locatorCandidates: [{ strategy: "testId", value: "inventory-item-name" }] },
        outputBindings: { text: "orderedItem" },
        risk: "safe"
      },
      {
        id: "extract-total",
        action: "extract",
        description: "Extract total price.",
        target: { locatorCandidates: [{ strategy: "testId", value: "total-label" }] },
        outputBindings: { text: "totalPrice" },
        risk: "safe"
      },
      {
        id: "final-check",
        action: "checkpoint",
        description: "Verify completion.",
        risk: "safe"
      }
    ],
    successCheckpoint: {
      id: "checkout-complete",
      urlIncludes: "/checkout-complete.html",
      textIncludes: ["Thank you for your order!"],
      outputAssertions: {
        confirmationMessage: "Thank you for your order!",
        resultKind: "success"
      }
    }
  };
}

describe("deterministic replay", () => {
  it("interprets artifact steps, resolves locator fallbacks, returns outputs, and writes evidence", async () => {
    const evidenceDir = await tempEvidenceDir();
    const surface = createMemorySurface({
      initialUrl: "about:blank",
      finalUrl: "https://www.saucedemo.com/checkout-complete.html",
      visibleText: "Thank you for your order!",
      locators: {
        "testId:username": "",
        "testId:password": "",
        "testId:login-button": "",
        "relativeText:Sauce Labs Backpack >> Add to cart": "",
        "testId:inventory-item-name": "Sauce Labs Backpack",
        "testId:total-label": "Total: $32.39"
      }
    });

    const result = await replayCapability({
      artifactInput: checkoutArtifact(),
      inputs: {
        username: "standard_user",
        password: "secret_sauce",
        productName: "Sauce Labs Backpack",
        firstName: "Ada",
        lastName: "Lovelace",
        postalCode: "90210"
      },
      evidenceDir,
      surface
    });

    expect(result.kind).toBe("success");
    if (result.kind !== "success") {
      throw new Error(`Expected success, received ${result.kind}`);
    }
    expect(result.outputs).toEqual({
      confirmationMessage: "Thank you for your order!",
      orderedItem: "Sauce Labs Backpack",
      totalPrice: "Total: $32.39",
      resultKind: "success"
    });
    expect(surface.calls.map((call) => call.type)).toEqual([
      "navigate",
      "type",
      "type",
      "click",
      "click",
      "extract",
      "extract"
    ]);
    expect(surface.calls.find((call) => call.stepId === "add-product")).toMatchObject({
      locator: "relativeText:Sauce Labs Backpack >> Add to cart"
    });

    const evidencePath = result.evidence[0];
    const evidence = await readFile(evidencePath, "utf8");
    expect(evidence).toContain('"event":"replay.started"');
    expect(evidence).toContain('"event":"step.succeeded"');
    expect(evidence).toContain('"artifactId":"sauce-demo-checkout"');
    expect(evidence).toContain('"password":"[REDACTED]"');
    expect(evidence).not.toContain("secret_sauce");
  });

  it("returns a hard failure when an artifact cannot be validated", async () => {
    const result = await replayCapability({
      artifactInput: { schemaVersion: "bad" },
      inputs: {},
      evidenceDir: await tempEvidenceDir(),
      surface: createMemorySurface()
    });

    expect(result).toMatchObject({
      ok: false,
      kind: "hard_failure",
      artifactId: "unknown",
      stepId: "artifact.validation"
    });
  });

  it("returns a hard failure before browser work when required inputs are missing", async () => {
    const surface = createMemorySurface();
    const result = await replayCapability({
      artifactInput: checkoutArtifact(),
      inputs: {},
      evidenceDir: await tempEvidenceDir(),
      surface
    });

    expect(result).toMatchObject({
      ok: false,
      kind: "hard_failure",
      artifactId: "sauce-demo-checkout",
      stepId: "invocation.inputs"
    });
    expect(surface.calls).toEqual([]);
  });

  it("denies actions outside the policy allowlist and captures richer failure evidence", async () => {
    const evidenceDir = await tempEvidenceDir();
    const artifact = checkoutArtifact();
    artifact.policy.allowedActions = ["navigate", "type", "wait", "extract", "checkpoint"];
    const result = await replayCapability({
      artifactInput: artifact,
      inputs: {
        username: "standard_user",
        password: "secret_sauce",
        productName: "Sauce Labs Backpack",
        firstName: "Ada",
        lastName: "Lovelace",
        postalCode: "90210"
      },
      evidenceDir,
      surface: createMemorySurface({
        visibleText: "Inventory page with leaked secret_sauce value",
        locators: {
          "testId:username": "",
          "testId:password": "",
          "testId:login-button": ""
        }
      })
    });

    expect(result).toMatchObject({
      ok: false,
      kind: "hard_failure",
      stepId: "login",
      expected: "Allowed action in policy"
    });
    const snapshotPath = result.evidence.find((evidencePath) => evidencePath.endsWith("login-snapshot.txt"));
    expect(snapshotPath).toBeDefined();
    const snapshot = await readFile(snapshotPath ?? "", "utf8");
    expect(snapshot).toContain("[REDACTED]");
    expect(snapshot).not.toContain("secret_sauce");
  });

  it("denies risky actions conservatively", async () => {
    const artifact = checkoutArtifact();
    artifact.steps[3].risk = "irreversible";

    const result = await replayCapability({
      artifactInput: artifact,
      inputs: {
        username: "standard_user",
        password: "secret_sauce",
        productName: "Sauce Labs Backpack",
        firstName: "Ada",
        lastName: "Lovelace",
        postalCode: "90210"
      },
      evidenceDir: await tempEvidenceDir(),
      surface: createMemorySurface({
        visibleText: "Inventory page",
        locators: {
          "testId:username": "",
          "testId:password": "",
          "testId:login-button": ""
        }
      })
    });

    expect(result).toMatchObject({
      ok: false,
      kind: "hard_failure",
      stepId: "login",
      expected: "Safe or explicitly handled action"
    });
  });

  it("denies post-action navigation outside the allowed route set", async () => {
    const result = await replayCapability({
      artifactInput: checkoutArtifact(),
      inputs: {
        username: "standard_user",
        password: "secret_sauce",
        productName: "Sauce Labs Backpack",
        firstName: "Ada",
        lastName: "Lovelace",
        postalCode: "90210"
      },
      evidenceDir: await tempEvidenceDir(),
      surface: createMemorySurface({
        finalUrl: "https://evil.example/phish",
        visibleText: "Moved away",
        locators: {
          "testId:username": "",
          "testId:password": "",
          "testId:login-button": ""
        }
      })
    });

    expect(result).toMatchObject({
      ok: false,
      kind: "hard_failure",
      stepId: "login",
      expected: "Allowed domain"
    });
  });

  it("reports a missing product as a known business outcome", async () => {
    const result = await replayCapability({
      artifactInput: checkoutArtifact(),
      inputs: {
        username: "standard_user",
        password: "secret_sauce",
        productName: "Sauce Labs Backpack",
        firstName: "Ada",
        lastName: "Lovelace",
        postalCode: "90210"
      },
      evidenceDir: await tempEvidenceDir(),
      surface: createMemorySurface({
        visibleText: "Inventory page",
        locators: {
          "testId:username": "",
          "testId:password": "",
          "testId:login-button": ""
        }
      })
    });

    expect(result).toMatchObject({
      ok: true,
      kind: "known_business_outcome",
      outcome: "product_not_found",
      stepId: "add-product"
    });
  });

  it("reports invalid login as a known business outcome", async () => {
    const result = await replayCapability({
      artifactInput: checkoutArtifact(),
      inputs: {
        username: "standard_user",
        password: "wrong_password",
        productName: "Sauce Labs Backpack",
        firstName: "Ada",
        lastName: "Lovelace",
        postalCode: "90210"
      },
      evidenceDir: await tempEvidenceDir(),
      surface: createMemorySurface({
        initialUrl: "https://www.saucedemo.com/",
        visibleText: "Epic sadface: Username and password do not match any user in this service\nPassword for all users: secret_sauce",
        locators: {
          "testId:username": "",
          "testId:password": "",
          "testId:login-button": ""
        }
      })
    });

    expect(result).toMatchObject({
      ok: true,
      kind: "known_business_outcome",
      outcome: "invalid_login",
      stepId: "login"
    });
    if (result.kind !== "known_business_outcome") {
      throw new Error(`Expected known business outcome, received ${result.kind}`);
    }
    expect(result.observed).toContain("Password for all users: [REDACTED]");
    expect(result.observed).not.toContain("secret_sauce");
  });

  it("recovers from transient locator misses with bounded retries in the evidence log", async () => {
    const evidenceDir = await tempEvidenceDir();
    const result = await replayCapability({
      artifactInput: checkoutArtifact(),
      inputs: {
        username: "standard_user",
        password: "secret_sauce",
        productName: "Sauce Labs Backpack",
        firstName: "Ada",
        lastName: "Lovelace",
        postalCode: "90210"
      },
      evidenceDir,
      surface: createMemorySurface({
        initialUrl: "about:blank",
        finalUrl: "https://www.saucedemo.com/checkout-complete.html",
        visibleText: "Thank you for your order!",
        locators: {
          "testId:username": "",
          "testId:password": "",
          "testId:login-button": "",
          "relativeText:Sauce Labs Backpack >> Add to cart": "",
          "testId:inventory-item-name": "Sauce Labs Backpack",
          "testId:total-label": "Total: $32.39"
        },
        unavailableUntilAttempt: {
          "relativeText:Sauce Labs Backpack >> Add to cart": 1
        }
      })
    });

    expect(result.kind).toBe("success");
    const evidencePath = result.evidence[0];
    const evidence = await readFile(evidencePath, "utf8");
    expect(evidence).toContain('"event":"step.retrying"');
    expect(evidence).toContain('"event":"step.recovered"');
    expect(evidence).toContain('"recovery":"bounded_locator_retry"');
  });
});
