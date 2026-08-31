# 02: Define capability artifact and result contracts

**What to build:** The system can validate a versioned capability artifact with typed inputs, outputs, locators, checkpoints, policy, and structured replay result kinds.

**Blocked by:** 01: Scaffold runnable automation shell.

**Status:** resolved

- [x] A capability artifact declares schema version, metadata, typed inputs, typed outputs, ordered steps, locator candidates, policy, and success checkpoint.
- [x] Sensitive inputs can be marked so they are never persisted as raw values in artifacts or logs.
- [x] Replay results distinguish success, known business outcome, recoverable condition, and hard failure in a typed contract.
- [x] Invalid artifacts fail validation with clear field-level errors.
- [x] Representative valid and invalid artifacts are covered by tests.

## Answer

Implemented a Zod-backed capability artifact contract with parsed TypeScript types, field-level validation errors, sensitive invocation input redaction, and typed replay result constructors for success, known business outcomes, recoverable conditions, and hard failures. Verification passed with `npm test`, `npm run typecheck`, and `npm run build`.
