import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";

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
    expect(stdout).toContain("mini-auto discover --goal <text> --target-url <url>");
    expect(stdout).toContain("mini-auto replay --artifact <path>");
    expect(stdout).toContain("mini-auto replay-only --artifact <path>");
  });

  it("returns structured configuration errors instead of throwing", async () => {
    const { result, stdout, exitCode } = await runCli(["discover", "--json"], {});

    expect(exitCode).toBe(1);
    expect(result.kind).toBe("configuration_error");
    expect(result.errors).toContain("Missing required flag: --goal <text>");
    expect(result.errors).toContain("Missing required flag: --target-url <url>");
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, kind: "configuration_error" });
  });

  it("validates a replay-only command and returns machine-readable output", async () => {
    const evidenceDir = await tempEvidenceDir();
    const { result, stdout, exitCode } = await runCli(
      ["replay-only", "--artifact", "artifacts/sauce-demo.json", "--json"],
      { MINI_AUTO_EVIDENCE_DIR: evidenceDir }
    );

    expect(exitCode).toBe(0);
    expect(result.ok).toBe(true);
    expect(JSON.parse(stdout)).toMatchObject({
      ok: true,
      command: "replay-only",
      data: {
        artifact: "artifacts/sauce-demo.json",
        evidenceDir,
        mode: "replay-only"
      }
    });
  });
});
