# 08: Produce end-to-end demo evidence

**What to build:** The repo contains saved evidence for a real LLM discovery run, deterministic replay, and one exceptional replay outcome, showing the full assignment thread.

**Blocked by:** 05: Build LLM-driven discovery into reusable artifacts; 06: Classify replay business outcomes and hard failures; 07: Implement human handoff on the live browser session.

**Status:** blocked-external-credential

- [x] Evidence includes a saved example capability artifact produced by discovery.
- [ ] Evidence includes logs from a genuine LLM-driven discovery run against the live Sauce Demo surface.
- [x] Evidence includes logs from deterministic replay without LLM decisions.
- [x] Evidence includes at least one exceptional replay outcome such as missing product, invalid login, or an injected hard failure.
- [x] Evidence is safe to commit and contains no raw secrets or sensitive values.

## Answer

Added `npm run demo:evidence`, which generates sanitized files under `evidence/demo/` and keeps ad hoc local evidence ignored. The committed evidence includes:

- `evidence/demo/discovered-capability.example.json`, produced by the discovery runner with an injected scripted decision engine.
- `evidence/demo/scripted-discovery-example/`, containing the discovery-runner log, observations, result, and generated artifact for deterministic review.
- `evidence/demo/deterministic-replay/`, containing a live deterministic Sauce Demo replay result and JSONL replay evidence with no LLM decisions.
- `evidence/demo/exceptional-invalid-login/`, containing a live invalid-login replay outcome classified as `known_business_outcome`.
- `evidence/demo/llm-discovery/README.md`, documenting the remaining genuine LLM discovery prerequisite.

The genuine LLM discovery run could not be produced in this shell because neither `MINI_AUTO_MODEL_API_KEY` nor `OPENAI_API_KEY` is set. To complete the remaining acceptance criterion, set `MINI_AUTO_MODEL_API_KEY` and rerun:

```powershell
npm run demo:evidence
```

Verified with:

- `npm run demo:evidence`
- `npm test -- --run test/demo-evidence.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm test`
