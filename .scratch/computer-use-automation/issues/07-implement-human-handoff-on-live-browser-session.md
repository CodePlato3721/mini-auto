# 07: Implement human handoff on the live browser session

**What to build:** Automation can pause when stuck or unsafe, produce an intervention request, expose the same session for manual action, record the handoff, and resume ownership.

**Blocked by:** 04: Add safety policy, redaction, and evidence logging.

**Status:** resolved

- [x] Automation has explicit ownership state for automated control, human control, and resumed automated control.
- [x] A stuck or unsafe condition creates an intervention request with goal, current step, reason, observed state, and screenshot or equivalent evidence.
- [x] The same live browser session remains available for human action while automation is paused.
- [x] Human activity during handoff is captured in evidence at a level appropriate for audit/debugging.
- [x] A resume signal hands control back to automation without losing workflow state.
- [x] Handoff behavior is covered at the control-state boundary by tests or a reproducible demo.

## Answer

Replay now supports a human handoff controller with explicit ownership states: `automation`, `human`, and `resumed_automation`. Explicit `handoff` steps and risky steps under `require_handoff` create intervention requests containing the goal, step, reason, expected condition, observed browser state, and a redacted handoff evidence snapshot.

During handoff, replay passes the same `BrowserSurface` instance to the controller and waits for a resume signal before continuing the existing workflow state. Human activity summaries are written to replay evidence, along with ownership transition and handoff lifecycle events.

The CLI now supports `--human-handoff` for replay flows. When enabled without an injected test surface, replay launches a headed Playwright browser and uses a terminal resume prompt so a human can act in the open live session before automation resumes.

Verified with:

- `npm test -- --run test/replay.test.ts`
- `npm test -- --run test/replay.test.ts test/cli.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm test`
