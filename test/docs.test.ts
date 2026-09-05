import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("project documentation", () => {
  it("documents setup, secrets, model-free replay, and exact demo commands", async () => {
    const readme = await readFile("README.md", "utf8");

    expect(readme).toContain("npm install");
    expect(readme).toContain("npx playwright install chromium");
    expect(readme).toContain("MINI_AUTO_MODEL_API_KEY");
    expect(readme).toContain("MINI_AUTO_PASSWORD");
    expect(readme).toContain("Do not commit `.env`, local input files, raw ad hoc evidence, or API keys.");
    expect(readme).toContain("Pass the username and product in `--goal`");
    expect(readme).toContain("node dist\\src\\interfaces\\cli.js discover");
    expect(readme).toContain("--goal \"Log in as standard_user, add Sauce Labs Backpack to the cart, and complete checkout.\" --inputs-file inputs.local.json");
    expect(readme).toContain("npm run demo:evidence");
    expect(readme).toContain("Handoff is enabled by default for replay");
    expect(readme).not.toContain("--human-handoff");
    expect(readme).toContain("fail <reason>");
    expect(readme).toContain("MINI_AUTO_DEBUG_PORT");
    expect(readme).toContain("set MINI_AUTO_DEBUG_PORT=9222");
    expect(readme).toContain("The CLI automatically loads it when present.");
    expect(readme).toContain("It launches a headed Chromium session");
    expect(readme).toContain("resume: <what changed>");
    expect(readme).not.toContain("--json");
  });

  it("uses exactly the required design report headings", async () => {
    const report = await readFile("docs/design-report.md", "utf8");
    const headings = report
      .split("\n")
      .filter((line) => line.startsWith("# "))
      .map((line) => line.slice(2).trim());

    expect(headings).toEqual([
      "Architecture",
      "Artifact schema",
      "Determinism & error handling",
      "Heterogeneity & multi-tenant",
      "Escalation & handoff",
      "Safety",
      "Cuts"
    ]);
    expect(report).toContain("legacy web");
    expect(report).toContain("desktop surface");
    expect(report).toContain("tenant overlays");
    expect(report).toContain("Onion Architecture");
    expect(report).toContain("multiple renters");
    expect(report).toContain("single-vendor bank back-office system");
    expect(report).toContain("src/interfaces/cli.ts");
    expect(report).toContain("src/infrastructure/model/openai-decision-engine.ts");
    expect(report).toContain("src/infrastructure/browser/playwright-surface.ts");
    expect(report).toContain("src/infrastructure/evidence/file-evidence-store.ts");
    expect(report).toContain("production operator console");
    expect(report).toContain("fail <reason>");
    expect(report).toContain("headed Chromium");
    expect(report).toContain("fast-forward decisions");
    expect(report).toContain("finish-checkout");
    expect(report).toContain("riskyActionHandling: require_handoff");
    expect(report).toContain("records each step's `safe`, `risky`, or `irreversible` label");
  });

  it("records the repo domain context and Onion ADR", async () => {
    const context = await readFile("CONTEXT.md", "utf8");
    const adr = await readFile("docs/adr/0001-use-onion-architecture.md", "utf8");

    expect(context).toContain("bank back-office workflows");
    expect(context).toContain("multiple renters");
    expect(context).toContain("Onion Architecture");
    expect(context).toContain("src/infrastructure");
    expect(adr).toContain("Status: accepted");
    expect(adr).toContain("Use Onion Architecture");
  });
});
