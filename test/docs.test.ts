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
    expect(readme).toContain("\"username\": \"standard_user\"");
    expect(readme).toContain("Pass the product in `--goal`");
    expect(readme).toContain("node dist\\src\\cli.js discover");
    expect(readme).toContain("--goal \"Add Sauce Labs Backpack to the cart and complete checkout.\" --inputs-file inputs.local.json");
    expect(readme).toContain("npm run demo:evidence");
    expect(readme).toContain("--human-handoff");
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
    expect(report).toContain("production operator console");
  });
});
