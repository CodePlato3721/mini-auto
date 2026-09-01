# Architecture

The system is a single-process TypeScript CLI with clear internal boundaries rather than separate services. `src/cli.ts` validates commands and environment configuration, `src/discovery.ts` owns model-driven exploration and artifact writing, `src/replay.ts` owns deterministic execution, browser adapters, outcome classification, evidence logging, and human handoff, and `src/contracts.ts` owns the Zod-validated artifact and result contracts.

Discovery and replay share the same `BrowserSurface` interface. That keeps Playwright-specific code at the edge and lets tests use `createMemorySurface` to exercise policy, redaction, outcome, and handoff behavior without relying on a browser. The CLI exposes `discover`, `replay`, and `replay-only`; the last two run saved artifacts without live model decisions.

The main tradeoff is intentional compactness. A production implementation would split orchestration, browser workers, evidence storage, and review surfaces into separate deployable components, but the prototype keeps those boundaries in code so the whole assignment remains runnable and inspectable.

# Artifact schema

The capability artifact is a versioned JSON document with metadata, typed inputs and outputs, a safety policy, ordered steps, and a success checkpoint. Steps use a deliberately small action vocabulary: `navigate`, `click`, `type`, `wait`, `extract`, `checkpoint`, and `handoff`.

Targets carry ordered locator candidates rather than a single selector. That allows replay to prefer stable locators such as test IDs while still supporting role, label, text, CSS, XPath, URL, relative text, and future visual locators. Input bindings parameterize values such as credentials, product name, and checkout fields; output bindings capture reusable data such as item name and total.

The schema is strict enough to reject malformed artifacts before browser work starts, but not so specific that it only fits Sauce Demo. Policy lives in the artifact because allowed domains, routes, actions, and risky-action handling are properties of a reusable capability, not only of a single invocation.

# Determinism & error handling

Replay is deterministic because it consumes a saved artifact, resolves locator candidates in order, uses invocation inputs only through explicit bindings, and validates the final checkpoint. It does not call the model during replay.

Runtime outcomes are structured. Success returns outputs and evidence. Known business outcomes, such as a missing product or invalid login, return `known_business_outcome` instead of hard failure. Transient locator misses use bounded retries and log `step.retrying` and `step.recovered`. Hard failures include the failed step, expected condition, observed state, and evidence pointers.

Policy and route checks run before or after actions as appropriate. Failure evidence includes the replay JSONL log and richer snapshots when available. Sensitive values are redacted from inputs, observed text, model decisions, snapshots, and committed demo evidence.

# Heterogeneity & multi-tenant

The `BrowserSurface` interface is the portability boundary. The current adapter uses Playwright for web pages, but the same command model could target legacy web through frame-aware locators, table and text anchors, OCR-backed visual locators, or accessibility-tree controls. A desktop surface could implement the same methods over tools such as UI Automation, Apple Accessibility, or a VNC/RDP driver.

For multi-tenant reuse, artifacts should separate canonical workflow intent from tenant overrides. A base artifact can define the steps, input and output contract, policy shape, and success checkpoint, while per-tenant overlays adjust domains, route prefixes, labels, locator priorities, and optional wait behavior.

Drift management should be evidence-driven. Replay logs identify the exact step, expectation, and observed state, which can feed review tooling that proposes locator updates or flags a tenant-specific divergence. High-confidence changes can become tenant overlays; low-confidence or risky changes should route to human handoff.

# Escalation & handoff

The replay engine has explicit ownership states: `automation`, `human`, and `resumed_automation`. A handoff can be requested by an explicit `handoff` artifact step or by a risky action when policy uses `require_handoff`.

An intervention request includes the goal, current step, reason, expected condition, observed browser state, and a redacted evidence snapshot. The handoff controller receives the same live `BrowserSurface` instance automation was using, so a human operates the current session rather than starting from a fresh browser.

The terminal handoff controller is intentionally minimal: with `--human-handoff`, replay launches a headed browser, pauses automation, prints the request, and waits for a resume signal. Human activity summaries and ownership transitions are recorded in evidence before replay continues with the same workflow state.

# Safety

Safety is enforced through artifact policy and runtime checks. Discovery only accepts safe structured decisions on the target host. Replay validates allowed actions, allowed domains, allowed routes, and risky-action handling. Irreversible or risky actions are blocked unless policy explicitly routes them to handoff.

Inputs marked sensitive are redacted from logs and result observations. Additional redaction handles common password hints shown by the demo site. Local raw evidence and `.env` files are ignored, while committed demo evidence is generated through a sanitizer and covered by a test.

The model is not trusted as an executor. It can propose discovery actions, but the runner validates action shape, target domain, and risk before acting. Replay does not use model decisions, which reduces nondeterminism and prevents model drift from changing a saved capability.

# Cuts

The prototype deliberately omits a production operator console, browser trace viewer, persistent job queue, remote browser farm, credential vault, artifact registry, tenant overlay format, and automated artifact repair. The handoff UI is a terminal prompt over a headed local browser because that proves the control-transfer model without building a full co-browsing product.

The discovery loop is intentionally simple: it asks for one structured action at a time and writes the artifact after completion. A stronger version would add planner memory, semantic page models, retryable model parsing, richer locator scoring, and post-run artifact minimization.

Practical next steps are to complete a genuine LLM discovery evidence run with `MINI_AUTO_MODEL_API_KEY`, add a tenant overlay file format, add Playwright trace capture for failures, support frame and visual locators, and build a small review UI for handoff requests and artifact drift proposals.
