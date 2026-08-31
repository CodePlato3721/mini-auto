# 04: Add safety policy, redaction, and evidence logging

**What to build:** Discovery and replay actions are checked against allowed domains and actions, sensitive inputs are redacted, and logs plus richer failure evidence are saved with enough detail to debug failures.

**Blocked by:** 03: Execute deterministic browser replay from a hand-authored artifact.

**Status:** resolved

- [x] Navigation and actions are denied when they fall outside the configured allowlist.
- [x] Risky or irreversible action classifications are represented and handled conservatively.
- [x] Sensitive input values are redacted consistently in structured logs, artifacts, errors, and evidence metadata.
- [x] Failure evidence includes at least one richer signal such as a screenshot, trace, or page snapshot.
- [x] Policy and redaction behavior are covered by focused tests.

## Answer

Implemented replay policy enforcement for allowed actions, allowed domains/routes, and risky or irreversible steps. Replay evidence now records redacted invocation metadata, failure results redact sensitive values, and browser/memory surfaces can attach richer failure evidence through screenshots, HTML snapshots, or text snapshots. Verification passed with `npm test`, `npm run typecheck`, `npm run build`, and a real compiled replay against Sauce Demo.
