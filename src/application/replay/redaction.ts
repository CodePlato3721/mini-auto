import type { CapabilityArtifact } from "../../domain/contracts.js";

export function createRedactor(artifact: CapabilityArtifact, inputs: Record<string, unknown>): (value: string) => string {
  const sensitiveValues = artifact.inputs
    .filter((input) => input.sensitive)
    .map((input) => inputs[input.name])
    .filter(
      (value): value is string | number | boolean =>
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    )
    .map(String)
    .filter((value) => value.length > 0);

  return (value: string) => {
    const redactedInputs = sensitiveValues.reduce(
      (redacted, sensitiveValue) => redacted.split(sensitiveValue).join("[REDACTED]"),
      value
    );
    return redactedInputs.replace(/(password(?:\s+for\s+all\s+users)?\s*:\s*)(\S+)/gi, "$1[REDACTED]");
  };
}
