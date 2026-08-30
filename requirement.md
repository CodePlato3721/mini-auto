# Requirements — Computer-Use Automation System

## 1. Functional requirements

### 1.1 Goal-driven agent loop
- Accept a natural-language goal plus a target (app/URL/entry point) as input.
- Run an LLM-driven observe → decide → act loop against a live surface until the goal is met or a stopping condition is hit (max steps, timeout, dead-end).
- Must actually interact with a real UI: click, type, navigate, read state.
- Approach should still work when the surface has no clean DOM.

### 1.2 Structured artifact (capability)
After a successful run, produce a typed, serializable, versioned artifact that includes at minimum:
- ordered steps/actions,
- how each target element/control is identified,
- typed input parameters (supplied per invocation),
- typed outputs/data to extract, with shape,
- a checkpoint or success condition.
- Must be decoupled from the raw model transcript.
- Must be reviewable by both a human and a calling agent.

### 1.3 Deterministic replay
- Given a saved artifact and input parameters, replay it without invoking the LLM for decisions.
- Must use stable element/control targeting.
- Must verify the checkpoint/success condition.
- Must return declared outputs to the caller.
- Must detect and handle runtime errors/exceptional states explicitly, distinguishing:
  - expected business outcomes (e.g. "no such member"),
  - recoverable conditions (e.g. dismiss known interstitial, wait/retry transient load),
  - hard failures (stop, surface a clear debuggable error).
- Must report a structured result: success (with outputs), known business outcome, or failure (with step, expected vs. observed detail).

### 1.4 Safety & policy guardrails
- Enforce an explicit, configurable allowlist (permitted domains/routes, permitted action types). Agent must not act outside it.
- Distinguish safe/reversible actions from risky/irreversible ones; handle the risky class conservatively (block, require confirmation, or flag).
- Never persist secrets or raw sensitive data (credentials, tokens, full PII) into artifacts or logs; redact appropriately.

### 1.5 Evidence / observability
- Produce a structured log of what the agent did and why.
- Produce at least one richer signal on failure (e.g. screenshot, DOM snapshot, trace).

### 1.6 Human-in-the-loop escalation & handoff
- Detect a stuck/blocked state and raise an intervention request to a human operator with context: capability/goal, current step, current state/screenshot, reason for stopping.
- Let the human take control of the same live session (not a fresh one).
- Hand control back so the run can resume or complete.
- Preserve context and evidence across the handoff; record what the human did.
- Automation must be able to pause, cede control, and resume on the same session.
- Must be a way to know who is (or should be) in control.
- Minimum acceptable scope: pause automation, expose the live session for manual control (mock operator surface allowed), signal resume, capture the human's actions. (Full real-time co-browsing console is not required.)

### 1.7 Design for heterogeneity & scale (write-up only, not required to build)
- Write-up must address how the artifact schema and replay engine would extend to a legacy web app and/or desktop app.
- Write-up must address how an artifact would be represented for reuse (or safe specialization/override) across tenants running the same underlying app, and how per-tenant/version drift would be detected and managed.
- Not required: actual implementation of multi-tenant or desktop support.
- Required: core abstractions must not preclude this extension.

## 2. Mandatory (non-negotiable) constraint
- At least one discovery run must be a genuine LLM-driven run against a live surface (not simulated/described), with evidence saved in `/evidence/`.

## 3. Deliverables

1. **Source code** in a public git repository, including `/README.md` covering:
   - setup/run instructions (keys/config needed, how to run without live services if applicable),
   - demo path: exact command(s) to run the agent on a goal, then replay the resulting artifact.

2. **Design write-up** at `/REPORT.md` (~1–3 pages) with exactly these seven headings:
   1. Architecture
   2. Artifact schema
   3. Determinism & error handling
   4. Heterogeneity & multi-tenant
   5. Escalation & handoff
   6. Safety
   7. Cuts

3. **Demonstration** in `/evidence/`:
   - a saved example artifact,
   - logs from a discovery run,
   - logs from a replay run,
   - ideally one replay that hits an error/exceptional state (bad input, not-found, or injected/simulated failure),
   - a screen recording is optional.

## 4. Ground rules / constraints
- AI-assisted development is allowed and expected; submitter must be able to explain/defend any part of the submission.
- Must not automate against sites in violation of their terms, in a way that harms the service, or using real credentials that shouldn't be used. Prefer sandboxes, demo sites, or a local app for anything sensitive.
- No real PII or real credentials.
- No secrets committed to the repo.
- Self-time-boxed; no fixed deadline, but must not be a month-long effort. If stopped early, remaining work must be documented as next steps.
- Explicitly out of scope / not required: implementing multi-tenant support, desktop support, scaling infrastructure (queues, clusters, multi-tenant plumbing), a full real-time co-browsing operator console.

## 5. Submission
- Push to a **public** GitHub repository.
- Email the repo link to **assignments@interface.ai**.
- Repo URL on its own line, sent from the address applied with, no zip file.
