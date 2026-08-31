# 06: Classify replay business outcomes and hard failures

**What to build:** Replay distinguishes success, known outcomes such as missing product or invalid login, recoverable wait/retry cases, and hard failures with step context and evidence.

**Blocked by:** 03: Execute deterministic browser replay from a hand-authored artifact; 04: Add safety policy, redaction, and evidence logging.

**Status:** resolved

- [x] Missing product is reported as a known business outcome rather than a hard failure.
- [x] Invalid login is reported as a known business outcome or clearly classified failure with step context.
- [x] Transient waits and retries are bounded and visible in the replay log.
- [x] Hard failures include failed step, expected condition, observed state, and evidence pointer.
- [x] Success, known outcome, recoverable retry, and hard failure paths are covered by tests or demo fixtures.

## Answer

Replay now has an explicit outcome path for known business conditions. Product locator exhaustion during add-to-cart is classified as `product_not_found`, invalid login pages are classified as `invalid_login`, and both return `known_business_outcome` results with step context and evidence pointers instead of hard failures.

Locator resolution now performs a bounded retry loop, logs `step.retrying` and `step.recovered` events, and records `bounded_locator_retry` in evidence. Hard failures still carry the failed step, expectation, observed state, and evidence path.

Verified with:

- `node dist\src\cli.js replay-only --artifact artifacts\sauce-demo-checkout.json --inputs-file evidence\sauce-demo-invalid-login.local.json --json`
- `npm test -- --run test/replay.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm test`
