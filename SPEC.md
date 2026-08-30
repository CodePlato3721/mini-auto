## Problem Statement

The user needs to design and implement a focused computer-use automation system for the take-home assignment. The system must show that an LLM can discover a workflow on a real UI, convert the successful run into a typed reusable capability artifact, and then replay that artifact deterministically without the LLM making decisions.

The immediate target surface will be Sauce Demo. The chosen workflow is to log in with demo credentials, add a selected product to the cart, complete checkout with fake customer data, and verify the order confirmation page. This is a suitable proxy for a legacy back-office workflow because it exercises login, navigation, item selection, form entry, output extraction, checkpoint verification, error handling, observability, and safety guardrails without using real credentials or PII.

## Solution

Build a narrow but extensible browser-based discovery and replay system. The discovery path uses an LLM-driven observe, decide, act loop against the live Sauce Demo UI. The replay path executes the saved capability artifact deterministically with no LLM decisions.

The system should be organized around a small set of clear domain components: a discovery runner, a browser session adapter, an LLM decision engine, a safety policy, an artifact builder, a replay runner, an evidence logger, and a human handoff controller.

The most important design principle is: the model discovers, the artifact becomes the product. Discovery may use LLM reasoning, but replay must be a deterministic interpreter over a typed artifact contract. The artifact should be reviewable by a human and invocable by a calling agent.

## User Stories

1. As a developer, I want to provide a natural-language goal and target URL, so that the discovery agent can start from a human-readable task.
2. As a developer, I want the discovery agent to open a real browser session, so that the assignment demonstrates actual UI interaction rather than simulation.
3. As a developer, I want the agent to observe URL, visible text, interactive controls, and screenshots, so that the LLM has enough context to choose the next action.
4. As a developer, I want the LLM to return structured actions only, so that the runtime can validate and execute decisions safely.
5. As a developer, I want the runtime to support navigation, click, type, wait, extract, checkpoint, and handoff actions, so that the Sauce Demo checkout workflow is fully covered.
6. As a developer, I want every proposed action checked against an allowlist, so that the agent cannot leave the permitted Sauce Demo surface.
7. As a developer, I want risky or irreversible actions classified separately from safe actions, so that replay can block or require handoff when needed.
8. As a developer, I want credentials and sensitive values supplied as invocation parameters, so that they are not persisted into reusable artifacts.
9. As a developer, I want logs to redact sensitive values, so that evidence can be committed safely.
10. As a developer, I want successful discovery actions recorded into an artifact, so that the discovered workflow becomes reusable.
11. As a developer, I want the artifact to declare typed inputs, so that callers know which values must be supplied at invocation time.
12. As a developer, I want the artifact to declare typed outputs, so that callers know what data replay returns.
13. As a developer, I want the artifact to declare a success checkpoint, so that replay can verify the workflow completed.
14. As a developer, I want element targets recorded with multiple locator candidates, so that replay is more robust than a single brittle selector.
15. As a developer, I want data-test locators preferred when available, so that Sauce Demo replay is stable.
16. As a developer, I want role, name, text, and relative-text locators captured as fallbacks, so that the design does not depend solely on clean DOM selectors.
17. As a developer, I want the artifact schema versioned, so that future schema changes can be managed deliberately.
18. As a developer, I want the artifact decoupled from raw model transcripts, so that replay does not depend on the LLM conversation.
19. As a calling agent, I want to invoke the saved checkout capability with typed arguments, so that I can reuse the workflow without re-discovering it.
20. As a calling agent, I want replay to return structured success outputs, so that I can consume the result programmatically.
21. As a calling agent, I want replay to classify known business outcomes separately from failures, so that expected results like missing products can be handled normally.
22. As a developer, I want invalid credentials to be reported as a known or hard failure with step context, so that login problems are debuggable.
23. As a developer, I want a missing product name to produce a known business outcome, so that error handling is demonstrated without breaking the system.
24. As a developer, I want transient page-load issues to be retried within limits, so that replay can handle ordinary runtime variance.
25. As a developer, I want hard failures to include the failed step, expectation, observed state, and evidence pointer, so that debugging is fast.
26. As a reviewer, I want saved discovery logs, so that I can confirm the LLM-driven run really happened.
27. As a reviewer, I want saved replay logs, so that I can confirm deterministic replay works without model decisions.
28. As a reviewer, I want at least one failure or exceptional replay log, so that I can see the result taxonomy in practice.
29. As a reviewer, I want screenshots or traces on failure, so that failures have richer evidence than plain logs.
30. As a human operator, I want the system to pause when it is stuck or unsafe, so that automation does not blindly continue.
31. As a human operator, I want an intervention request with goal, step, reason, state, and screenshot, so that I can understand what needs action.
32. As a human operator, I want to take control of the same live browser session, so that I do not lose the current workflow state.
33. As a human operator, I want to signal resume after manual intervention, so that automation can continue or complete.
34. As a developer, I want human actions recorded during handoff, so that evidence and audit context are preserved.
35. As a developer, I want explicit ownership state for automation versus human control, so that there is no ambiguity during handoff.
36. As a reviewer, I want the design write-up to explain legacy web and desktop extension points, so that the browser implementation does not look like a dead end.
37. As a reviewer, I want the design write-up to explain tenant reuse and drift handling, so that the system maps back to the bank and credit union environment.
38. As a developer, I want setup and demo commands documented, so that the full discovery and replay path is easy to run.
39. As a developer, I want a no-live-service or replay-only mode, so that reviewers can inspect behavior without spending model calls.
40. As a submitter, I want cuts documented clearly, so that the assignment shows deliberate scope control rather than accidental omissions.

## Implementation Decisions

- The initial target surface will be Sauce Demo because it is a public demo site intended for automation practice and avoids real credentials, PII, and terms-of-service risk.
- The primary workflow will log in, add a named product to the cart, proceed through checkout, extract total and confirmation data, and verify the final order confirmation page.
- The discovery system will use a two-layer design: an LLM decision layer that chooses the next action, and a browser/runtime layer that observes, validates, executes, records, and logs.
- The discovery loop will follow observe, decide, validate, act, record, and check completion.
- The LLM decision engine will return strict structured actions rather than prose instructions.
- The runtime will own all browser execution and selector resolution. The LLM may suggest intent and targets, but it does not directly operate the browser.
- The action vocabulary will be deliberately small: navigate, click, type, wait, extract, checkpoint, and request handoff.
- The browser observation will include current URL, title, visible text, interactive element summaries, locator candidates, and screenshot references.
- The artifact builder will record only successful validated actions, not failed guesses or raw chain-of-thought.
- The artifact will be a typed, serializable, versioned capability contract with inputs, outputs, policy, steps, target locators, checkpoint, and metadata.
- The Sauce Demo capability will use inputs for username, password, product name, first name, last name, and postal code.
- Password will be marked sensitive and redacted from logs and artifacts.
- The capability outputs will include confirmation message, ordered item data, total price, and result kind.
- The success checkpoint will require the checkout completion URL and the order confirmation text.
- Locator strategy will store multiple candidates in priority order. For Sauce Demo, data-test selectors are preferred, with role/name and text-relative candidates as fallbacks.
- The artifact target model should allow future visual or accessibility selectors so the design can extend to legacy web and desktop surfaces.
- Deterministic replay will interpret the artifact step by step without invoking the LLM for decisions.
- Replay will validate checkpoints and return a structured result of success, known business outcome, or failure.
- Known business outcomes will include cases such as product not found or invalid business input.
- Recoverable conditions will include bounded waits and retries for transient load or known interstitial states.
- Hard failures will stop execution and include failed step, expected condition, observed state, and evidence pointers.
- Safety policy will enforce allowed domains, routes, and action types during discovery and replay.
- Risky or irreversible actions will be blocked or routed to handoff. Sauce Demo checkout can be treated as safe because it is a demo transaction, but the policy model should still exist.
- Evidence logging will use structured event logs for both discovery and replay, plus screenshots or traces when failures occur.
- Human handoff will be implemented as a minimal real control-transfer mechanism: automation pauses, ownership changes to human, the same browser session remains available, human activity is captured, and resume returns control to automation.
- The design write-up will explicitly explain that desktop and multi-tenant support are not implemented, but the artifact and surface adapter boundaries are shaped so those extensions are possible.
- The final assignment report must use the required seven headings from the assignment brief.

## Testing Decisions

- The highest-value testing seam is the external CLI behavior: run discovery against the live target, save evidence and artifact, then replay the artifact with inputs and assert the structured result.
- Tests should focus on externally visible behavior rather than implementation details. A good test proves that a goal produces an artifact, replay uses that artifact without LLM decisions, outputs are returned, and failures are classified correctly.
- The replay runner should be tested more heavily than the discovery runner because replay is the production execution path and should be deterministic.
- Artifact schema validation should be tested with representative valid and invalid artifacts.
- Safety policy should be tested at the policy boundary: disallowed domain, disallowed action, sensitive input redaction, and risky action behavior.
- Locator resolution should be tested through replay behavior rather than by asserting private selector-ranking internals.
- Error taxonomy should be tested with a successful checkout, a product-not-found case, an invalid-login case, and a simulated or injected hard failure.
- Evidence logging should be tested by verifying that logs and failure screenshots or traces are produced and that sensitive fields are redacted.
- Handoff should be tested at the control-state boundary: automation pauses, intervention request is created, owner changes to human, resume restores automation ownership, and actions during the handoff are recorded.
- Because the current repository has no source code or prior tests, there is no existing test seam to reuse. The first implementation should create one high-level integration seam around the command surface and focused unit seams for schema validation, policy, redaction, and result classification.

## Out of Scope

- Automating real bank or credit union systems.
- Using real credentials, real PII, or real customer data.
- Implementing desktop automation in the first build.
- Implementing true multi-tenant infrastructure, queues, clusters, artifact distribution, or tenant administration.
- Building a full real-time co-browsing operator console.
- Building a generic automation platform that supports every website.
- Allowing open-ended LLM recovery during deterministic replay.
- Persisting raw model transcripts as the replay artifact.
- Optimizing for broad feature coverage before the discovery-to-replay vertical slice works end to end.

## Further Notes

The repository currently contains only the assignment materials and local tool settings. It is not yet a git repository and has no existing source modules, tests, ADRs, or issue tracker configuration.

The requested issue-tracker publication could not be completed because the issue tracker and triage label vocabulary were not provided. Per the skill instructions, run `/setup-matt-pocock-skills` before publishing this spec to the project issue tracker with the `ready-for-agent` label.

The assignment materials contain visible encoding artifacts in punctuation. Before generating final submission-facing documentation, normalize the source documents to UTF-8 so headings and arrows render cleanly.
