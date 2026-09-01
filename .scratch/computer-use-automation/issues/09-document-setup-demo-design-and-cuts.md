# 09: Document setup, demo commands, design, and cuts

**What to build:** A reviewer can set up the project, run discovery and replay or replay-only mode, and read the required seven-section design report with clear scope tradeoffs.

**Blocked by:** 08: Produce end-to-end demo evidence.

**Status:** resolved

- [x] The README explains setup, required configuration, secrets handling, and how to run without live model calls where applicable.
- [x] The README gives exact demo commands for discovery and deterministic replay.
- [x] The report uses exactly the required seven headings: Architecture, Artifact schema, Determinism & error handling, Heterogeneity & multi-tenant, Escalation & handoff, Safety, and Cuts.
- [x] The report explains how the design extends to legacy web, desktop surfaces, and tenant-specific reuse or drift management.
- [x] The report documents deliberate scope cuts and practical next steps.

## Answer

Added a reviewer-facing `README.md` with setup, Playwright installation, verification commands, model configuration, secrets handling, model-free replay, live discovery, deterministic replay, exceptional outcome, and human handoff commands.

Added `docs/design-report.md` with exactly the required seven headings: Architecture, Artifact schema, Determinism & error handling, Heterogeneity & multi-tenant, Escalation & handoff, Safety, and Cuts. The report covers legacy web and desktop extension paths, tenant-specific reuse and drift management, deliberate scope cuts, and practical next steps.

Added `test/docs.test.ts` so the required commands and exact report heading contract are checked by the test suite.

Verified with:

- `npm test -- --run test/docs.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm test`
