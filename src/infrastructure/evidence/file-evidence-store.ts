import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { EvidenceLog, EvidenceStore } from "../../application/evidence.js";

export function createFileEvidenceStore(): EvidenceStore {
  return {
    createReplayLog(evidenceDir) {
      return createJsonlLog(evidenceDir, "replay");
    },
    createDiscoveryLog(evidenceDir) {
      return createJsonlLog(evidenceDir, "discovery");
    },
    async readJsonFile(filePath) {
      return JSON.parse(await readFile(filePath, "utf8")) as unknown;
    },
    async writeJsonFile(evidenceDir, fileName, value) {
      const filePath = path.resolve(evidenceDir, fileName);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      return filePath;
    },
    async writeTextEvidence(evidenceDir, fileName, value) {
      const filePath = path.resolve(evidenceDir, fileName);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, value, "utf8");
      return filePath;
    }
  };
}

function createJsonlLog(evidenceDir: string, prefix: string): EvidenceLog {
  const logPath = path.resolve(evidenceDir, `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  const entries: string[] = [];

  return {
    path: logPath,
    append(event, data) {
      entries.push(JSON.stringify({ time: new Date().toISOString(), event, ...data }));
    },
    async flush() {
      await mkdir(path.dirname(logPath), { recursive: true });
      await writeFile(logPath, `${entries.join("\n")}\n`, "utf8");
    }
  };
}
