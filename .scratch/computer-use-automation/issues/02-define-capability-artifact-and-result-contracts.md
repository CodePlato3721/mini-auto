# 02: Define capability artifact and result contracts

**What to build:** The system can validate a versioned capability artifact with typed inputs, outputs, locators, checkpoints, policy, and structured replay result kinds.

**Blocked by:** 01: Scaffold runnable automation shell.

**Status:** ready-for-agent

- [ ] A capability artifact declares schema version, metadata, typed inputs, typed outputs, ordered steps, locator candidates, policy, and success checkpoint.
- [ ] Sensitive inputs can be marked so they are never persisted as raw values in artifacts or logs.
- [ ] Replay results distinguish success, known business outcome, recoverable condition, and hard failure in a typed contract.
- [ ] Invalid artifacts fail validation with clear field-level errors.
- [ ] Representative valid and invalid artifacts are covered by tests.
