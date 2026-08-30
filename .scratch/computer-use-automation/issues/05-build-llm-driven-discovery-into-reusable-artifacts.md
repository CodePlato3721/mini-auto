# 05: Build LLM-driven discovery into reusable artifacts

**What to build:** A natural-language Sauce Demo checkout goal can drive a real browser with observe, decide, validate, act, and record steps, then emit a reusable artifact from successful validated actions.

**Blocked by:** 02: Define capability artifact and result contracts; 04: Add safety policy, redaction, and evidence logging.

**Status:** ready-for-agent

- [ ] Discovery accepts a natural-language goal, target URL, and invocation parameters.
- [ ] The browser observation includes current URL, title, visible text, interactive controls, locator candidates, and screenshot references.
- [ ] The LLM decision engine returns only structured actions that the runtime validates before execution.
- [ ] Only successful validated actions are recorded into the capability artifact.
- [ ] A completed discovery run produces an artifact that deterministic replay can consume.
- [ ] Discovery evidence proves the run interacted with a real live UI.
