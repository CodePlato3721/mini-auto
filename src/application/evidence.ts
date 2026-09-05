export type EvidenceLog = {
  path: string;
  append(event: string, data: Record<string, unknown>): void;
  flush(): Promise<void>;
};

export type EvidenceStore = {
  createReplayLog(evidenceDir: string): EvidenceLog;
  createDiscoveryLog(evidenceDir: string): EvidenceLog;
  readJsonFile(filePath: string): Promise<unknown>;
  writeJsonFile(evidenceDir: string, fileName: string, value: unknown): Promise<string>;
  writeTextEvidence(evidenceDir: string, fileName: string, value: string): Promise<string>;
};
