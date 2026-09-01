import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("demo evidence", () => {
  it("keeps committed demo evidence sanitized and documented", async () => {
    const files = await listFiles(path.resolve("evidence", "demo"));
    const relativeFiles = files.map((file) => path.relative("evidence/demo", file).replace(/\\/g, "/"));
    expect(relativeFiles).toEqual(
      expect.arrayContaining([
        "MANIFEST.md",
        "discovered-capability.example.json",
        "deterministic-replay/result.json",
        "exceptional-invalid-login/result.json"
      ])
    );
    expect(relativeFiles.some((file) => file === "llm-discovery/README.md" || file === "llm-discovery/result.json")).toBe(true);

    const searchableBodies = await Promise.all(
      files.filter((file) => !file.endsWith(".png")).map((file) => readFile(file, "utf8"))
    );
    const combined = searchableBodies.join("\n");
    expect(combined).not.toContain("secret_sauce");
    expect(combined).not.toContain("wrong_password");
    expect(combined).not.toContain("C:\\Users\\");
    expect(combined).toContain("known_business_outcome");
    expect(combined).toMatch(/MINI_AUTO_MODEL_API_KEY|\"command\": \"discover\"/);
  });
});

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      return entry.isDirectory() ? await listFiles(fullPath) : [fullPath];
    })
  );
  return files.flat();
}
