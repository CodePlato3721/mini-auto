import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { runCli } from "../src/interfaces/cli.js";
import type { DecisionEngine } from "../src/application/discovery.js";
import type { HumanHandoffController } from "../src/application/ports/human-handoff.js";
import { createMemorySurface } from "../src/infrastructure/browser/memory-surface.js";

const repoRoot = process.cwd();
const evidenceRoot = path.resolve(repoRoot, "evidence", "demo");
const secretValues = ["secret_sauce", "wrong_password"];

async function main(): Promise<void> {
  await rm(evidenceRoot, { recursive: true, force: true });
  await mkdir(evidenceRoot, { recursive: true });

  await writeFile(
    path.join(evidenceRoot, "inputs.example.json"),
    `${JSON.stringify(
      {
        username: "standard_user",
        firstName: "Ada",
        lastName: "Lovelace",
        postalCode: "90210"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const scriptedDiscoveryDir = path.join(evidenceRoot, "scripted-discovery-example");
  await mkdir(scriptedDiscoveryDir, { recursive: true });
  const scriptedDiscovery = await runCli(
    [
      "discover",
      "--goal",
      "Log in as standard_user to Sauce Demo, add Sauce Labs Backpack to the cart, complete checkout with fake customer data, and verify the order confirmation.",
      "--target-url",
      "https://www.saucedemo.com/",
      "--inputs-json",
      JSON.stringify(fileInputs())
    ],
    {
      MINI_AUTO_MODEL_API_KEY: "scripted-engine",
      MINI_AUTO_PASSWORD: demoPassword()
    },
    {
      decisionEngine: scriptedCheckoutEngine(),
      discoverySurface: createMemorySurface({
        initialUrl: "about:blank",
        finalUrl: "https://www.saucedemo.com/checkout-complete.html",
        visibleText: "Thank you for your order!",
        locators: checkoutLocators()
      }),
      evidenceDir: scriptedDiscoveryDir
    }
  );
  await writeFile(path.join(scriptedDiscoveryDir, "result.json"), sanitize(scriptedDiscovery.stdout), "utf8");
  await sanitizeDirectory(scriptedDiscoveryDir);
  await copyFile(
    path.join(scriptedDiscoveryDir, "discovered-capability.json"),
    path.join(evidenceRoot, "discovered-capability.example.json")
  );

  const replayDir = path.join(evidenceRoot, "deterministic-replay");
  const replayInputs = path.join(replayDir, "inputs.local.json");
  await mkdir(replayDir, { recursive: true });
  await writeFile(replayInputs, JSON.stringify(fileInputs()), "utf8");
  const replay = await runCli(
    [
      "replay-only",
      "--artifact",
      "artifacts/sauce-demo-checkout.json",
      "--goal",
      "Log in as standard_user, add Sauce Labs Backpack to the cart, and complete checkout.",
      "--inputs-file",
      replayInputs
    ],
    { MINI_AUTO_PASSWORD: demoPassword() },
    { handoffController: scriptedHandoffController(), evidenceDir: replayDir }
  );
  await rm(replayInputs, { force: true });
  await writeFile(path.join(replayDir, "result.json"), sanitize(replay.stdout), "utf8");
  await sanitizeDirectory(replayDir);

  const exceptionalDir = path.join(evidenceRoot, "exceptional-invalid-login");
  const badInputs = path.join(exceptionalDir, "inputs.local.json");
  await mkdir(exceptionalDir, { recursive: true });
  await writeFile(badInputs, JSON.stringify(fileInputs()), "utf8");
  const exceptional = await runCli(
    [
      "replay-only",
      "--artifact",
      "artifacts/sauce-demo-checkout.json",
      "--goal",
      "Log in as standard_user, add Sauce Labs Backpack to the cart, and complete checkout.",
      "--inputs-file",
      badInputs
    ],
    { MINI_AUTO_PASSWORD: "wrong_password" },
    { evidenceDir: exceptionalDir }
  );
  await rm(badInputs, { force: true });
  await writeFile(path.join(exceptionalDir, "result.json"), sanitize(exceptional.stdout), "utf8");
  await sanitizeDirectory(exceptionalDir);

  const discoveryDir = path.join(evidenceRoot, "llm-discovery");
  await mkdir(discoveryDir, { recursive: true });
  if (process.env.MINI_AUTO_MODEL_API_KEY && process.env.MINI_AUTO_PASSWORD) {
    const discoveryInputs = path.join(discoveryDir, "inputs.local.json");
    await writeFile(discoveryInputs, JSON.stringify(fileInputs()), "utf8");
    const discovery = await runCli(
      [
        "discover",
        "--goal",
        "Log in as standard_user to Sauce Demo, add Sauce Labs Backpack to the cart, complete checkout with fake customer data, and verify the order confirmation.",
      "--target-url",
      "https://www.saucedemo.com/",
      "--inputs-file",
      discoveryInputs
      ],
      process.env,
      { evidenceDir: discoveryDir }
    );
    await rm(discoveryInputs, { force: true });
    await writeFile(path.join(discoveryDir, "result.json"), sanitize(discovery.stdout), "utf8");
    await sanitizeDirectory(discoveryDir);
  } else {
    await writeFile(
      path.join(discoveryDir, "README.md"),
      [
        "# LLM Discovery Evidence",
        "",
        "The genuine LLM discovery run requires `MINI_AUTO_MODEL_API_KEY` and `MINI_AUTO_PASSWORD` at generation time.",
        "Run `npm run demo:evidence` with those environment variables set to populate this directory with a live discovery log and generated artifact.",
        ""
      ].join("\n"),
      "utf8"
    );
  }

  await writeManifest();
}

function scriptedHandoffController(): HumanHandoffController {
  return {
    async waitForResume(context) {
      return {
        signal: "resume",
        activities: [{ description: `Scripted demo approved ${context.request.stepId}.` }]
      };
    }
  };
}

function fileInputs(): Record<string, string> {
  return {
    firstName: "Ada",
    lastName: "Lovelace",
    postalCode: "90210"
  };
}

function demoPassword(): string {
  return "secret_sauce";
}

function checkoutLocators(): Record<string, string> {
  return {
    "testId:username": "",
    "testId:password": "",
    "testId:login-button": "",
    "relativeText:Sauce Labs Backpack >> Add to cart": "",
    "testId:shopping-cart-link": "",
    "testId:inventory-item-name": "Sauce Labs Backpack",
    "testId:checkout": "",
    "testId:firstName": "",
    "testId:lastName": "",
    "testId:postalCode": "",
    "testId:continue": "",
    "testId:total-label": "Total: $32.39",
    "testId:finish": ""
  };
}

function scriptedCheckoutEngine(): DecisionEngine {
  const decisions: unknown[] = [
    {
      action: "navigate",
      description: "Open the Sauce Demo login page.",
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
      action: "type",
      description: "Enter password.",
      target: { locatorCandidates: [{ strategy: "testId", value: "password" }] },
      inputBindings: { value: "password" },
      risk: "safe"
    },
    {
      action: "click",
      description: "Submit login.",
      target: { locatorCandidates: [{ strategy: "testId", value: "login-button" }] },
      risk: "safe"
    },
    {
      action: "click",
      description: "Add the requested product to the cart.",
      target: { locatorCandidates: [{ strategy: "relativeText", value: "{{productName}} >> Add to cart" }] },
      risk: "safe"
    },
    {
      action: "click",
      description: "Open the cart.",
      target: { locatorCandidates: [{ strategy: "testId", value: "shopping-cart-link" }] },
      risk: "safe"
    },
    {
      action: "extract",
      description: "Extract the cart item name.",
      target: { locatorCandidates: [{ strategy: "testId", value: "inventory-item-name" }] },
      outputBindings: { text: "orderedItem" },
      risk: "safe"
    },
    {
      action: "click",
      description: "Start checkout.",
      target: { locatorCandidates: [{ strategy: "testId", value: "checkout" }] },
      risk: "safe"
    },
    {
      action: "type",
      description: "Enter first name.",
      target: { locatorCandidates: [{ strategy: "testId", value: "firstName" }] },
      inputBindings: { value: "firstName" },
      risk: "safe"
    },
    {
      action: "type",
      description: "Enter last name.",
      target: { locatorCandidates: [{ strategy: "testId", value: "lastName" }] },
      inputBindings: { value: "lastName" },
      risk: "safe"
    },
    {
      action: "type",
      description: "Enter postal code.",
      target: { locatorCandidates: [{ strategy: "testId", value: "postalCode" }] },
      inputBindings: { value: "postalCode" },
      risk: "safe"
    },
    {
      action: "click",
      description: "Continue checkout.",
      target: { locatorCandidates: [{ strategy: "testId", value: "continue" }] },
      risk: "safe"
    },
    {
      action: "extract",
      description: "Extract total price.",
      target: { locatorCandidates: [{ strategy: "testId", value: "total-label" }] },
      outputBindings: { text: "totalPrice" },
      risk: "safe"
    },
    {
      action: "click",
      description: "Finish checkout.",
      target: { locatorCandidates: [{ strategy: "testId", value: "finish" }] },
      risk: "risky"
    },
    {
      action: "checkpoint",
      description: "Verify checkout completion.",
      risk: "safe"
    },
    { complete: true }
  ];

  return {
    async decide(_observation, context) {
      return decisions[context.stepNumber - 1] ?? { complete: true };
    }
  };
}

async function sanitizeDirectory(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await sanitizeDirectory(fullPath);
      continue;
    }
    if (entry.name.endsWith(".png")) {
      continue;
    }
    const body = await readFile(fullPath, "utf8");
    await writeFile(fullPath, sanitize(body), "utf8");
  }
}

function sanitize(value: string): string {
  const escapedRepoRoot = repoRoot.replace(/\\/g, "\\\\");
  return secretValues.reduce(
    (redacted, secret) => redacted.split(secret).join("[REDACTED]"),
    value.split(repoRoot).join("<repo>").split(escapedRepoRoot).join("<repo>")
  );
}

async function writeManifest(): Promise<void> {
  await writeFile(
    path.join(evidenceRoot, "MANIFEST.md"),
    [
      "# Demo Evidence Manifest",
      "",
      "Generated with `npm run demo:evidence`.",
      "",
      "- `discovered-capability.example.json`: checked-in example capability artifact matching the discovery output contract.",
      "- `scripted-discovery-example/`: discovery-runner evidence produced with an injected scripted decision engine for deterministic review.",
      "- `deterministic-replay/`: live deterministic replay result and JSONL evidence generated without LLM decisions.",
      "- `exceptional-invalid-login/`: exceptional replay outcome showing `known_business_outcome` handling and redaction.",
      "- `llm-discovery/`: location for the genuine LLM-driven discovery run. It is populated when `MINI_AUTO_MODEL_API_KEY` is set.",
      "",
      "Committed evidence is sanitized: local absolute paths are replaced with `<repo>`, and sensitive values are redacted.",
      ""
    ].join("\n"),
    "utf8"
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
