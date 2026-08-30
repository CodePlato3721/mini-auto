# 07: Implement human handoff on the live browser session

**What to build:** Automation can pause when stuck or unsafe, produce an intervention request, expose the same session for manual action, record the handoff, and resume ownership.

**Blocked by:** 04: Add safety policy, redaction, and evidence logging.

**Status:** ready-for-agent

- [ ] Automation has explicit ownership state for automated control, human control, and resumed automated control.
- [ ] A stuck or unsafe condition creates an intervention request with goal, current step, reason, observed state, and screenshot or equivalent evidence.
- [ ] The same live browser session remains available for human action while automation is paused.
- [ ] Human activity during handoff is captured in evidence at a level appropriate for audit/debugging.
- [ ] A resume signal hands control back to automation without losing workflow state.
- [ ] Handoff behavior is covered at the control-state boundary by tests or a reproducible demo.
