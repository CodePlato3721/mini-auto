# Architecture

`mini-auto` is a TypeScript CLI for browser automation. It uses Onion Architecture:

- `src/domain`: artifact and result contracts
- `src/application`: discovery, replay, ports
- `src/interfaces`: CLI
- `src/infrastructure`: Playwright, OpenAI, file evidence

The main decision is to separate discovery from replay. Discovery can use an LLM to choose actions. Replay never asks the LLM what to do. It only runs a saved artifact.

The trade-off is scope. This is one local process, not a production worker system. The code still has replaceable ports for browser control, human handoff, evidence storage, and model calls.

# Artifact schema

The artifact is a versioned JSON capability. It contains:

- metadata
- typed inputs and outputs
- safety policy
- ordered steps
- success checkpoint

Steps use a small action set: `navigate`, `click`, `type`, `wait`, `extract`, `checkpoint`, and `handoff`.

Targets use ordered locator candidates instead of one selector. Replay can try `testId`, role, label, text, CSS, XPath, URL, or relative text in order.

Input bindings keep secrets out of the artifact. The artifact stores "use the password input", not the password value.

Example artifacts/evidence are included under `artifacts/sauce-demo-checkout.json` and `evidence/demo/discovered-capability.example.json`.

# Determinism & error handling

Replay is deterministic because it uses only:

- the saved artifact
- explicit invocation inputs
- fixed locator order
- fixed policy checks
- a fixed success checkpoint

It does not call the LLM during replay.

Errors return structured JSON. Invalid login is reported as `known_business_outcome`. Locator failures become hard failures with step ID, expected condition, observed state, and evidence paths.

UI drift is handled conservatively. Replay retries locator misses briefly. If it is still stuck, it captures evidence and can hand off to a human.

Demo evidence includes a replay run at `evidence/demo/deterministic-replay/` and an exceptional invalid-login run at `evidence/demo/exceptional-invalid-login/`.

# Heterogeneity & multi-tenant

The seam is `BrowserSurface` in `src/application/ports/browser-surface.ts`.

The artifact says what to do. The surface adapter decides how to do it. Today that adapter is Playwright Chromium.

A legacy web adapter could add frames, table anchors, OCR, and XPath fallbacks. A desktop surface could use Windows UI Automation, Apple Accessibility, or RDP/VNC.

For multi-tenant scale, artifacts should be layered:

`base artifact + vendor-version overlay + tenant overlay + hotfix overlay`

The base artifact captures the shared vendor workflow. Tenant overlays only change what differs: domain, route prefix, labels, optional steps, locator priority, timing, known outcomes, and risk policy.

Drift comes from replay evidence. Many tenants failing the same step means update the base artifact. One tenant failing means create or update a tenant overlay. Risky or uncertain changes go to human review.

# Escalation & handoff

Replay escalates when:

- locator candidates fail after retries
- the artifact has a `handoff` step
- the step is `risky` or `irreversible`

Replay launches headed Chromium. On handoff, the CLI prints the goal, step, reason, observed page state, and evidence path.

The human fixes the visible browser. Then they type:

- `resume`
- `resume: <what changed>`
- `fail <reason>`

On resume, replay records the human summary. It retries the current step or fast-forwards if the human already moved to a later page.

# Safety

Safety has three layers:

- schema validation
- artifact policy
- runtime checks

Discovery only accepts structured model decisions and blocks navigation outside the target host. Replay enforces allowed actions, domains, routes, and risk handling.

Actions are labeled `safe`, `risky`, or `irreversible`. Risky actions require handoff when the policy says `require_handoff`. The Sauce Demo checkout finish step is marked risky to model a real approval boundary.

Sensitive inputs are redacted from logs and evidence. This prototype does not include a credential vault, remote browser isolation, or production approval workflow.

# Cuts

I left out production infrastructure:

- job queue
- hosted browser farm
- operator web console
- credential vault
- artifact registry
- tenant overlay implementation
- browser trace viewer
- automated artifact repair

Next I would build tenant overlays, richer evidence, a review UI, credential vault integration, remote browser workers, and legacy-web/desktop adapters.

# Criteria Matches


