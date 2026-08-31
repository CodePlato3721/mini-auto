import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";
import { createMemorySurface } from "../src/replay.js";

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
      ["replay-only", "--artifact", artifactPath, "--inputs-file", inputsPath, "--json"],
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

  it("returns a structured configuration error when the artifact file is missing", async () => {
    const evidenceDir = await tempEvidenceDir();
    const { result, stdout, exitCode } = await runCli(
      ["replay", "--artifact", path.join(evidenceDir, "missing.json"), "--json"],
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
});
