import { z } from "zod";

const semanticVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/, {
  message: "Expected semantic version format such as 1.0.0"
});

const inputTypeSchema = z.enum(["string", "number", "boolean", "date", "currency", "json"]);
const outputTypeSchema = inputTypeSchema;
const actionTypeSchema = z.enum(["navigate", "click", "type", "wait", "extract", "checkpoint", "handoff"]);
const locatorStrategySchema = z.enum([
  "testId",
  "role",
  "label",
  "text",
  "css",
  "xpath",
  "url",
  "relativeText",
  "visual"
]);

const artifactMetadataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  source: z.string().min(1).optional()
});

const artifactInputSchema = z.object({
  name: z.string().min(1),
  type: inputTypeSchema,
  required: z.boolean(),
  sensitive: z.boolean().default(false),
  description: z.string().min(1).optional()
});

const artifactOutputSchema = z.object({
  name: z.string().min(1),
  type: outputTypeSchema,
  required: z.boolean(),
  description: z.string().min(1).optional()
});

const locatorCandidateSchema = z.object({
  strategy: locatorStrategySchema,
  value: z.string().min(1),
  name: z.string().min(1).optional(),
  frame: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional()
});

const stepTargetSchema = z.object({
  locatorCandidates: z.array(locatorCandidateSchema).min(1)
});

const artifactStepSchema = z.object({
  id: z.string().min(1),
  action: actionTypeSchema,
  description: z.string().min(1),
  target: stepTargetSchema.optional(),
  inputBindings: z.record(z.string(), z.string()).default({}),
  outputBindings: z.record(z.string(), z.string()).default({}),
  risk: z.enum(["safe", "risky", "irreversible"])
});

const safetyPolicySchema = z.object({
  allowedDomains: z.array(z.string().min(1)).min(1),
  allowedRoutes: z.array(z.string().min(1)).min(1),
  allowedActions: z.array(actionTypeSchema).min(1),
  riskyActionHandling: z.enum(["block", "require_handoff", "require_confirmation"]).default("require_handoff")
});

const successCheckpointSchema = z.object({
  id: z.string().min(1),
  urlIncludes: z.string().min(1).optional(),
  textIncludes: z.array(z.string().min(1)).default([]),
  outputAssertions: z.record(z.string(), z.string()).default({})
});

export const capabilityArtifactSchema = z.object({
  schemaVersion: semanticVersionSchema,
  metadata: artifactMetadataSchema,
  inputs: z.array(artifactInputSchema).min(1),
  outputs: z.array(artifactOutputSchema).default([]),
  policy: safetyPolicySchema,
  steps: z.array(artifactStepSchema).min(1),
  successCheckpoint: successCheckpointSchema
});

export type CapabilityArtifact = z.infer<typeof capabilityArtifactSchema>;
export type CapabilityArtifactInput = z.input<typeof capabilityArtifactSchema>;
export type CapabilityInput = z.infer<typeof artifactInputSchema>;
export type CapabilityOutput = z.infer<typeof artifactOutputSchema>;
export type CapabilityStep = z.infer<typeof artifactStepSchema>;
export type LocatorCandidate = z.infer<typeof locatorCandidateSchema>;
export type ActionType = z.infer<typeof actionTypeSchema>;

export type ValidationError = {
  path: string;
  message: string;
};

export type ArtifactParseResult =
  | { ok: true; artifact: CapabilityArtifact; errors?: never }
  | { ok: false; artifact?: never; errors: ValidationError[] };

export type ReplayResult =
  | ReplaySuccessResult
  | ReplayKnownBusinessOutcomeResult
  | ReplayRecoverableConditionResult
  | ReplayHardFailureResult;

export type ReplaySuccessResult = {
  ok: true;
  kind: "success";
  artifactId: string;
  outputs: Record<string, unknown>;
  evidence: string[];
};

export type ReplayKnownBusinessOutcomeResult = {
  ok: true;
  kind: "known_business_outcome";
  artifactId: string;
  outcome: string;
  stepId?: string;
  observed: string;
  evidence: string[];
};

export type ReplayRecoverableConditionResult = {
  ok: true;
  kind: "recoverable_condition";
  artifactId: string;
  condition: string;
  stepId: string;
  recovery: string;
  attempts: number;
  evidence: string[];
};

export type ReplayHardFailureResult = {
  ok: false;
  kind: "hard_failure";
  artifactId: string;
  stepId: string;
  expected: string;
  observed: string;
  evidence: string[];
};

export function parseCapabilityArtifact(value: unknown): ArtifactParseResult {
  const parsed = capabilityArtifactSchema.safeParse(value);
  if (parsed.success) {
    return { ok: true, artifact: parsed.data };
  }

  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message
    }))
  };
}

export function redactInvocationInputs(
  artifact: CapabilityArtifact,
  inputs: Record<string, unknown>
): Record<string, unknown> {
  const sensitiveInputNames = new Set(
    artifact.inputs.filter((input) => input.sensitive).map((input) => input.name)
  );

  return Object.fromEntries(
    Object.entries(inputs).map(([name, value]) => [name, sensitiveInputNames.has(name) ? "[REDACTED]" : value])
  );
}

export function successReplayResult(args: {
  artifactId: string;
  outputs: Record<string, unknown>;
  evidence: string[];
}): ReplaySuccessResult {
  return {
    ok: true,
    kind: "success",
    artifactId: args.artifactId,
    outputs: args.outputs,
    evidence: args.evidence
  };
}

export function knownBusinessOutcomeReplayResult(args: {
  artifactId: string;
  outcome: string;
  stepId?: string;
  observed: string;
  evidence: string[];
}): ReplayKnownBusinessOutcomeResult {
  return {
    ok: true,
    kind: "known_business_outcome",
    artifactId: args.artifactId,
    outcome: args.outcome,
    stepId: args.stepId,
    observed: args.observed,
    evidence: args.evidence
  };
}

export function recoverableConditionReplayResult(args: {
  artifactId: string;
  condition: string;
  stepId: string;
  recovery: string;
  attempts: number;
  evidence: string[];
}): ReplayRecoverableConditionResult {
  return {
    ok: true,
    kind: "recoverable_condition",
    artifactId: args.artifactId,
    condition: args.condition,
    stepId: args.stepId,
    recovery: args.recovery,
    attempts: args.attempts,
    evidence: args.evidence
  };
}

export function hardFailureReplayResult(args: {
  artifactId: string;
  stepId: string;
  expected: string;
  observed: string;
  evidence: string[];
}): ReplayHardFailureResult {
  return {
    ok: false,
    kind: "hard_failure",
    artifactId: args.artifactId,
    stepId: args.stepId,
    expected: args.expected,
    observed: args.observed,
    evidence: args.evidence
  };
}
