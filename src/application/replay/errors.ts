export class ReplayStepError extends Error {
  constructor(
    readonly stepId: string,
    readonly expected: string,
    observed: string
  ) {
    super(observed);
  }
}

export class ReplayOutcomeError extends ReplayStepError {
  constructor(
    stepId: string,
    readonly outcome: string,
    observed: string
  ) {
    super(stepId, "Known business outcome check", observed);
  }
}
