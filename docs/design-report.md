# Architecture

The system is a single-process TypeScript CLI organized around Onion Architecture rather than separate services. The core domain lives in `src/domain`, application use cases and ports live in `src/application`, CLI/HTTP interface adapters live in `src/interfaces`, and concrete Playwright/filesystem adapters live in `src/infrastructure`.

This shape fits a bank back-office product with multiple renters and one vendor-controlled system: the interface can stay simple while workflow policy, tenant variation, and exception handling become complex. `src/domain/contracts.ts` owns the Zod-validated artifact and result contracts. Application services own discovery, replay, and goal/input enrichment. `src/application/ports/browser-surface.ts` owns the surface port. `src/interfaces/cli.ts` validates command syntax and delegates business interpretation inward. `src/infrastructure/model/openai-decision-engine.ts` owns the OpenAI Responses API call used by live discovery. `src/infrastructure/browser/playwright-surface.ts` owns Playwright control, and `src/infrastructure/evidence/file-evidence-store.ts` owns JSONL, artifact, and text evidence files.

Discovery and replay share the same `BrowserSurface` boundary. That keeps browser implementation concerns outside the domain and lets tests use `createMemorySurface` to exercise policy, redaction, outcome, and handoff behavior without relying on a browser. The CLI exposes `discover`, `replay`, and `replay-only`; the last two run saved artifacts without live model decisions.

The main tradeoff is intentional compactness. A production implementation would split browser workers, evidence storage, tenant configuration, and review surfaces into separate deployable components, but the prototype keeps those boundaries in code so the whole assignment remains runnable and inspectable.

# Artifact schema

The capability artifact is a versioned JSON document with metadata, typed inputs and outputs, a safety policy, ordered steps, and a success checkpoint. Steps use a deliberately small action vocabulary: `navigate`, `click`, `type`, `wait`, `extract`, `checkpoint`, and `handoff`.

Targets carry ordered locator candidates rather than a single selector. That allows replay to prefer stable locators such as test IDs while still supporting role, label, text, CSS, XPath, URL, relative text, and future visual locators. Input bindings parameterize values such as credentials, product name, and checkout fields; output bindings capture reusable data such as item name and total.

The schema is strict enough to reject malformed artifacts before browser work starts, but not so specific that it only fits Sauce Demo. Policy lives in the artifact because allowed domains, routes, actions, and risky-action handling are properties of a reusable capability, not only of a single invocation.

# Determinism & error handling

Replay is deterministic because it consumes a saved artifact, resolves locator candidates in order, uses invocation inputs only through explicit bindings, and validates the final checkpoint. It does not call the model during replay.

Runtime outcomes are structured. Success returns outputs and evidence. Known business outcomes, such as a missing product or invalid login, return `known_business_outcome` instead of hard failure. Transient locator misses use bounded retries and log `step.retrying` and `step.recovered`. Hard failures include the failed step, expected condition, observed state, and evidence pointers.

Policy and route checks run before or after actions as appropriate. Failure evidence includes the replay JSONL log and richer snapshots when available. Sensitive values are redacted from inputs, observed text, model decisions, snapshots, and committed demo evidence.

# Heterogeneity & multi-tenant

The seam between recorded flow and surface-specific control is the `BrowserSurface` port. The artifact stores semantic workflow steps: `click`, `type`, `extract`, `checkpoint`, ordered locator candidates, input and output bindings, risk, and policy. It does not store Playwright objects, DOM handles, browser state, or model decisions. Replay asks a surface adapter to answer questions such as "does this locator exist?", "click this resolved target", "type this value", "what URL or visible text is current?", and "capture evidence." That means the same recorded flow can stay stable while the perception and action implementation changes per environment.

For a modern web app, the current Playwright adapter resolves test IDs, roles, labels, text, CSS, XPath, URL, and relative text. For a legacy web app, the adapter can add frame-aware resolution, table row anchors, brittle-but-contained XPath fallbacks, OCR text anchors, and visual targets without changing replay's control loop. For a desktop surface, another adapter could implement the same port over Windows UI Automation, Apple Accessibility, or an RDP/VNC driver. The artifact would still say "click the Approve button for account 123"; the adapter decides whether that means a DOM locator, accessibility node, OCR bounding box, or desktop control id.

At scale, artifacts should be represented as layered assets rather than one recording per tenant in the single-vendor bank back-office system. A base artifact captures the vendor workflow for a product/version family: stable step IDs, semantic descriptions, input/output contract, expected success checkpoint, default locator candidates, and default safety policy. The tenant overlays specialize only what varies: domain and route prefixes, feature flags, tenant-specific labels, locator candidate priority, optional or skipped steps, wait budgets, known business outcomes, and risk handling. Overlays should be small, explicit, and versioned against the base artifact so review can see whether a tenant changed policy, targeting, or workflow shape.

The runtime should resolve an execution plan by applying overlays in order: base vendor artifact, product-version overlay, tenant overlay, and emergency hotfix overlay. Each layer should be validated against the same schema and policy rules before replay starts. Overrides should reference stable step IDs instead of copying full step arrays, so a base artifact update can flow to hundreds of tenants without silently overwriting tenant-specific behavior.

Drift detection should come from replay evidence. Every failure already records the step ID, expected condition, observed URL/text, locator candidates tried, screenshot/HTML where available, and whether handoff was needed. A production registry can aggregate this by vendor version and tenant: if many tenants fail on the same base step after a release, propose a base artifact update; if one tenant fails because of label or route differences, propose a tenant overlay; if the failed step is risky or low-confidence, route it to human review. Successful handoffs should record the operator summary and resumed step so later repair tooling can infer whether the artifact should skip ahead, add a locator, or model a tenant-specific branch.

This design does not require implementing desktop automation or multi-tenant registry now, but it keeps the core abstraction from closing those paths. The domain owns workflow intent and policy; surface adapters own perception and actuation; overlays own tenant variation; evidence owns drift signals.

# Escalation & handoff

The replay engine has explicit ownership states: `automation`, `human`, and `resumed_automation`. A handoff can be requested by an explicit `handoff` artifact step or by a risky action when policy uses `require_handoff`.

An intervention request includes the goal, current step, reason, expected condition, observed browser state, and a redacted evidence snapshot. The handoff controller receives the same live `BrowserSurface` instance automation was using, so a human operates the current session rather than starting from a fresh browser.

The terminal handoff controller is intentionally minimal but production-shaped: replay launches headed Chromium by default, pauses automation when handoff is needed, prints the request, and exposes Chromium remote-debugging attach instructions for the same live session. The operator fixes the visible browser session and types `resume`, `resume: <what changed>`, or `fail <reason>` when the issue cannot be resolved. After resume, replay reconciles the live page against the remaining artifact steps so a human can move the workflow forward before returning control. Human activity summaries, operator failure reasons, fast-forward decisions, and ownership transitions are recorded in evidence before replay continues or returns a structured hard failure.

# Safety

Safety is enforced through artifact policy and runtime checks. Discovery accepts structured decisions on the target host, records each step's `safe`, `risky`, or `irreversible` label, applies a small deterministic normalization for common action classes such as login versus final checkout submit, and refuses navigation outside the target host. Replay validates allowed actions, allowed domains, allowed routes, and risky-action handling. Irreversible or risky actions are blocked unless policy explicitly routes them to handoff.

The checked-in Sauce Demo artifact marks `finish-checkout` as `risky` with `riskyActionHandling: require_handoff`. Sauce Demo has no real-world side effect, but this models the production boundary where a bank back-office submit or approve action should require explicit operator review before execution.

Inputs marked sensitive are redacted from logs and result observations. Additional redaction handles common password hints shown by the demo site. Local raw evidence and `.env` files are ignored, while committed demo evidence is generated through a sanitizer and covered by a test.

The model is not trusted as the production executor. It can propose discovery actions and risk labels, but the runner validates action shape and target domain before acting. Replay does not use model decisions, which reduces nondeterminism and prevents model drift from changing a saved capability.

# Cuts

The prototype deliberately omits a production operator console, browser trace viewer, persistent job queue, remote browser farm, credential vault, artifact registry, tenant overlay format, and automated artifact repair. The handoff UI is a terminal prompt over a headed local browser because that proves the control-transfer model without building a full co-browsing product.

The discovery loop is intentionally simple: it asks for one structured action at a time and writes the artifact after completion. A stronger version would add planner memory, semantic page models, retryable model parsing, richer locator scoring, and post-run artifact minimization.

Practical next steps are to complete a genuine LLM discovery evidence run with `MINI_AUTO_MODEL_API_KEY`, add a tenant overlay file format, add Playwright trace capture for failures, support frame and visual locators, and build a small review UI for handoff requests and artifact drift proposals.
