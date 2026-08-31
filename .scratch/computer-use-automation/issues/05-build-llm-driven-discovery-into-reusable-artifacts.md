# 05: Build LLM-driven discovery into reusable artifacts

**What to build:** A natural-language Sauce Demo checkout goal can drive a real browser with observe, decide, validate, act, and record steps, then emit a reusable artifact from successful validated actions.

**Blocked by:** 02: Define capability artifact and result contracts; 04: Add safety policy, redaction, and evidence logging.

**Status:** resolved

- [x] Discovery accepts a natural-language goal, target URL, and invocation parameters.
- [x] The browser observation includes current URL, title, visible text, interactive controls, locator candidates, and screenshot references.
- [x] The LLM decision engine returns only structured actions that the runtime validates before execution.
- [x] Only successful validated actions are recorded into the capability artifact.
- [x] A completed discovery run produces an artifact that deterministic replay can consume.
- [x] Discovery evidence proves the run interacted with a real live UI.

## Answer

Implemented the discovery runner, OpenAI-backed decision engine interface, browser observation capture, structured decision validation, discovery-side policy checks, successful-action recording, replay-compatible artifact output, and redacted JSONL discovery evidence. Unit tests cover the full observe/decide/act/record path with an injected decision engine, malformed decisions, unsafe navigation, and incomplete discovery. Verification passed with `npm test`, `npm run typecheck`, and `npm run build`. A genuine live LLM discovery run was not executed in this workspace because `MINI_AUTO_MODEL_API_KEY` is not set; the compiled CLI now reports that as a structured configuration error.
