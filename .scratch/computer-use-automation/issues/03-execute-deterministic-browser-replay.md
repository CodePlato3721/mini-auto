# 03: Execute deterministic browser replay from a hand-authored artifact

**What to build:** A saved Sauce Demo checkout capability can replay without LLM decisions, fill invocation parameters, verify confirmation, return outputs, and write replay evidence.

**Blocked by:** 02: Define capability artifact and result contracts.

**Status:** resolved

- [x] Replay interprets an artifact step by step without invoking an LLM for decisions.
- [x] Replay supports the action types needed for Sauce Demo checkout: navigate, click, type, wait, extract, and checkpoint.
- [x] Locator resolution prefers stable candidates and can fall back to alternate candidates declared in the artifact.
- [x] Successful replay returns declared outputs including confirmation data, ordered item data, total price, and result kind.
- [x] A replay log is written with enough structured detail to verify which artifact and inputs were used.

## Answer

Implemented deterministic artifact replay with a Playwright browser adapter, a memory surface for tests, locator fallback resolution, invocation input binding, output extraction, checkpoint verification, and JSONL replay evidence. Added a hand-authored Sauce Demo checkout artifact and example inputs. Verified with `npm test`, `npm run typecheck`, `npm run build`, and a real compiled `replay-only` run against Sauce Demo.
