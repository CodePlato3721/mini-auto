# 03: Execute deterministic browser replay from a hand-authored artifact

**What to build:** A saved Sauce Demo checkout capability can replay without LLM decisions, fill invocation parameters, verify confirmation, return outputs, and write replay evidence.

**Blocked by:** 02: Define capability artifact and result contracts.

**Status:** ready-for-agent

- [ ] Replay interprets an artifact step by step without invoking an LLM for decisions.
- [ ] Replay supports the action types needed for Sauce Demo checkout: navigate, click, type, wait, extract, and checkpoint.
- [ ] Locator resolution prefers stable candidates and can fall back to alternate candidates declared in the artifact.
- [ ] Successful replay returns declared outputs including confirmation data, ordered item data, total price, and result kind.
- [ ] A replay log is written with enough structured detail to verify which artifact and inputs were used.
