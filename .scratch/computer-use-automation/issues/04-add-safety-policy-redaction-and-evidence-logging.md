# 04: Add safety policy, redaction, and evidence logging

**What to build:** Discovery and replay actions are checked against allowed domains and actions, sensitive inputs are redacted, and logs plus richer failure evidence are saved with enough detail to debug failures.

**Blocked by:** 03: Execute deterministic browser replay from a hand-authored artifact.

**Status:** ready-for-agent

- [ ] Navigation and actions are denied when they fall outside the configured allowlist.
- [ ] Risky or irreversible action classifications are represented and handled conservatively.
- [ ] Sensitive input values are redacted consistently in structured logs, artifacts, errors, and evidence metadata.
- [ ] Failure evidence includes at least one richer signal such as a screenshot, trace, or page snapshot.
- [ ] Policy and redaction behavior are covered by focused tests.
