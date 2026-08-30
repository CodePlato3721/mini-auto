# 06: Classify replay business outcomes and hard failures

**What to build:** Replay distinguishes success, known outcomes such as missing product or invalid login, recoverable wait/retry cases, and hard failures with step context and evidence.

**Blocked by:** 03: Execute deterministic browser replay from a hand-authored artifact; 04: Add safety policy, redaction, and evidence logging.

**Status:** ready-for-agent

- [ ] Missing product is reported as a known business outcome rather than a hard failure.
- [ ] Invalid login is reported as a known business outcome or clearly classified failure with step context.
- [ ] Transient waits and retries are bounded and visible in the replay log.
- [ ] Hard failures include failed step, expected condition, observed state, and evidence pointer.
- [ ] Success, known outcome, recoverable retry, and hard failure paths are covered by tests or demo fixtures.
