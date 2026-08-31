import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  parseCapabilityArtifact,
  hardFailureReplayResult,
  knownBusinessOutcomeReplayResult,
  recoverableConditionReplayResult,
  redactInvocationInputs,
  successReplayResult,
  type CapabilityArtifactInput
} from "../src/contracts.js";

function validArtifact(): CapabilityArtifactInput {
  return {
    schemaVersion: "1.0.0",
    metadata: {
      id: "sauce-demo-checkout",
      name: "Sauce Demo Checkout",
      description: "Adds a product to the cart and completes checkout.",
      createdAt: "2026-08-30T00:00:00.000Z"
    },
    inputs: [
      { name: "username", type: "string", required: true, sensitive: false },
      { name: "password", type: "string", required: true, sensitive: true },
      { name: "postalCode", type: "string", required: true, sensitive: false }
    ],
    outputs: [
      { name: "confirmationMessage", type: "string", required: true },
      { name: "totalPrice", type: "currency", required: true }
    ],
    policy: {
      allowedDomains: ["www.saucedemo.com"],
      allowedRoutes: ["/", "/inventory.html", "/checkout-step-two.html", "/checkout-complete.html"],
      allowedActions: ["navigate", "click", "type", "wait", "extract", "checkpoint"]
    },
    steps: [
      {
        id: "open-login",
        action: "navigate",
        description: "Open the Sauce Demo login page.",
        target: {
          locatorCandidates: [{ strategy: "url", value: "https://www.saucedemo.com/" }]
        },
        inputBindings: {},
        outputBindings: {},
        risk: "safe"
      },
      {
        id: "submit-password",
        action: "type",
        description: "Enter the password supplied for this invocation.",
        target: {
          locatorCandidates: [{ strategy: "testId", value: "password" }]
        },
        inputBindings: { value: "password" },
        outputBindings: {},
        risk: "safe"
      }
    ],
    successCheckpoint: {
      id: "checkout-complete",
      urlIncludes: "/checkout-complete.html",
      textIncludes: ["Thank you for your order!"]
    }
  };
}

describe("capability artifact contracts", () => {
  it("accepts the checked-in Sauce Demo checkout artifact", async () => {
    const artifact = JSON.parse(await readFile("artifacts/sauce-demo-checkout.json", "utf8")) as unknown;
    const parsed = parseCapabilityArtifact(artifact);

    expect(parsed.ok).toBe(true);
    expect(parsed.artifact?.metadata.id).toBe("sauce-demo-checkout");
  });

  it("accepts a versioned artifact with typed IO, locators, policy, steps, and checkpoint", () => {
    const parsed = parseCapabilityArtifact(validArtifact());

    expect(parsed.ok).toBe(true);
    expect(parsed.artifact?.schemaVersion).toBe("1.0.0");
    expect(parsed.artifact?.inputs.find((input) => input.name === "password")?.sensitive).toBe(true);
    expect(parsed.artifact?.steps[0]?.target?.locatorCandidates[0]).toMatchObject({
      strategy: "url",
      value: "https://www.saucedemo.com/"
    });
  });

  it("returns field-level errors for invalid artifacts", () => {
    const parsed = parseCapabilityArtifact({
      ...validArtifact(),
      schemaVersion: "v1",
      metadata: { id: "", name: "", createdAt: "not-a-date" },
      policy: {
        allowedDomains: [],
        allowedRoutes: [],
        allowedActions: []
      },
      steps: []
    });

    expect(parsed.ok).toBe(false);
    expect(parsed.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "schemaVersion" }),
        expect.objectContaining({ path: "metadata.id" }),
        expect.objectContaining({ path: "metadata.name" }),
        expect.objectContaining({ path: "metadata.createdAt" }),
        expect.objectContaining({ path: "policy.allowedDomains" }),
        expect.objectContaining({ path: "policy.allowedRoutes" }),
        expect.objectContaining({ path: "policy.allowedActions" }),
        expect.objectContaining({ path: "steps" })
      ])
    );
  });

  it("redacts sensitive invocation inputs based on the artifact contract", () => {
    const parsed = parseCapabilityArtifact(validArtifact());
    expect(parsed.ok).toBe(true);

    if (!parsed.ok) {
      throw new Error("Expected fixture artifact to parse.");
    }

    const redacted = redactInvocationInputs(parsed.artifact, {
      username: "standard_user",
      password: "secret_sauce",
      postalCode: "90210"
    });

    expect(redacted).toEqual({
      username: "standard_user",
      password: "[REDACTED]",
      postalCode: "90210"
    });
  });

  it("declares structured replay result kinds", () => {
    const success = successReplayResult({
      artifactId: "sauce-demo-checkout",
      outputs: { confirmationMessage: "Thank you for your order!" },
      evidence: ["evidence/replay.jsonl"]
    });
    const knownOutcome = knownBusinessOutcomeReplayResult({
      artifactId: "sauce-demo-checkout",
      outcome: "product_not_found",
      stepId: "choose-product",
      observed: "Inventory page did not contain the requested product.",
      evidence: ["evidence/replay-not-found.jsonl"]
    });
    const recoverable = recoverableConditionReplayResult({
      artifactId: "sauce-demo-checkout",
      condition: "slow_page_load",
      stepId: "open-cart",
      recovery: "waited_for_checkpoint",
      attempts: 2,
      evidence: ["evidence/replay-retry.jsonl"]
    });
    const failure = hardFailureReplayResult({
      artifactId: "sauce-demo-checkout",
      stepId: "finish-checkout",
      expected: "Checkout completion checkpoint",
      observed: "Browser navigated outside the allowed route set.",
      evidence: ["evidence/replay-failure.jsonl"]
    });

    expect(success).toEqual({
      ok: true,
      kind: "success",
      artifactId: "sauce-demo-checkout",
      outputs: { confirmationMessage: "Thank you for your order!" },
      evidence: ["evidence/replay.jsonl"]
    });
    expect(knownOutcome.kind).toBe("known_business_outcome");
    expect(recoverable.kind).toBe("recoverable_condition");
    expect(failure).toMatchObject({ ok: false, kind: "hard_failure" });
  });
});
