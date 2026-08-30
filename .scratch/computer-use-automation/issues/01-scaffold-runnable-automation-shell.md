# 01: Scaffold runnable automation shell

**What to build:** A developer can run the project from the command line, see typed help and configuration validation, and get structured success or failure output from a minimal command path.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] A developer can install dependencies and run a command that prints validated usage for discovery, replay, and replay-only flows.
- [x] Missing or invalid required configuration produces a structured failure instead of an unhandled exception.
- [x] The command surface returns machine-readable result output suitable for later replay and demo automation.
- [x] The initial implementation includes a minimal automated test or smoke check for the command surface.

## Answer

Implemented a TypeScript CLI scaffold with `discover`, `replay`, and `replay-only` command validation, JSON/plain-text output formatting, evidence directory setup, and Vitest smoke coverage. Verification passed with `npm test`, `npm run typecheck`, `npm run build`, and direct compiled CLI smoke checks.
