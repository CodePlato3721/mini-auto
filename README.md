# mini-auto

`mini-auto` is a small TypeScript browser automation prototype for the Sauce Demo checkout workflow. It supports two modes:

- Discovery: an LLM observes a live browser surface and records successful actions into a reusable capability artifact.
- Replay: a saved capability artifact runs deterministically without model calls, with policy checks, redacted evidence, outcome classification, and human handoff.

## Setup

Requirements:

- Node.js 22 or newer.
- Network access to `https://www.saucedemo.com/` for live discovery or replay.
- A model API key only for live LLM discovery.

Install dependencies:

```powershell
npm install
npx playwright install chromium
```

Run the local verification suite:

```powershell
npm test
npm run typecheck
npm run build
```

## Configuration And Secrets

Evidence is written to `./evidence` by default. Set `MINI_AUTO_EVIDENCE_DIR` to write elsewhere:

```powershell
$env:MINI_AUTO_EVIDENCE_DIR = "evidence/local-run"
```

Live LLM discovery requires `MINI_AUTO_MODEL_API_KEY`. `MINI_AUTO_MODEL` is optional and defaults to `gpt-5-mini`. Use `MINI_AUTO_PASSWORD` for the workflow password instead of storing it in a JSON file.

```powershell
$env:MINI_AUTO_MODEL_API_KEY = "<your model API key>"
$env:MINI_AUTO_MODEL = "gpt-5-mini"
$env:MINI_AUTO_PASSWORD = "secret_sauce"
```

Do not commit `.env`, local input files, raw ad hoc evidence, or API keys. The committed `evidence/demo/` files are sanitized; local evidence outside that folder stays ignored by git. The Sauce Demo password is treated as sensitive input and is redacted in replay and discovery logs.

Keep `inputs.local.json` to non-secret fields. Pass the product in `--goal`; the CLI infers known Sauce Demo product names from the goal.

```json
{
  "username": "standard_user",
  "firstName": "Ada",
  "lastName": "Lovelace",
  "postalCode": "90210"
}
```

## Run Without Live Model Calls

Deterministic replay needs no model key. Use the checked-in artifact, pass the product in `--goal`, and set the password in `MINI_AUTO_PASSWORD`:

```powershell
npm run build
$env:MINI_AUTO_PASSWORD = "secret_sauce"
node dist\src\cli.js replay-only --artifact artifacts\sauce-demo-checkout.json --goal "Add Sauce Labs Backpack to the cart and complete checkout." --inputs-file inputs.local.json --json
```

Generate sanitized demo evidence, including replay evidence and a scripted discovery-runner example:

```powershell
npm run demo:evidence
```

## Live LLM Discovery Demo

With `MINI_AUTO_MODEL_API_KEY` set, run a genuine discovery pass against the live Sauce Demo surface:

```powershell
$env:MINI_AUTO_EVIDENCE_DIR = "evidence/live-discovery"
$env:MINI_AUTO_PASSWORD = "secret_sauce"
node dist\src\cli.js discover --goal "Log in to Sauce Demo, add Sauce Labs Backpack to the cart, complete checkout with fake customer data, and verify the order confirmation." --target-url "https://www.saucedemo.com/" --inputs-file inputs.local.json --json
```

Replay the artifact produced by that discovery run:

```powershell
node dist\src\cli.js replay-only --artifact evidence\live-discovery\discovered-capability.json --goal "Add Sauce Labs Backpack to the cart and complete checkout." --inputs-file inputs.local.json --json
```

## Exceptional Outcome Demo

Invalid login is classified as a known business outcome instead of an infrastructure failure:

```powershell
$env:MINI_AUTO_PASSWORD = "wrong_password"
node dist\src\cli.js replay-only --artifact artifacts\sauce-demo-checkout.json --goal "Add Sauce Labs Backpack to the cart and complete checkout." --inputs-file inputs.local.json --json
```

## Human Handoff Demo

Replay can pause on explicit `handoff` steps or risky actions that require handoff. With `--human-handoff`, the browser is launched headed and the terminal waits for a resume signal:

```powershell
$env:MINI_AUTO_PASSWORD = "secret_sauce"
node dist\src\cli.js replay --artifact artifacts\sauce-demo-checkout.json --goal "Add Sauce Labs Backpack to the cart and complete checkout." --inputs-file inputs.local.json --human-handoff --json
```

The checked-in Sauce Demo artifact has no handoff step, so this command behaves like replay unless the artifact is edited to include `handoff` or a risky action.

## Design Report

See [docs/design-report.md](docs/design-report.md) for the required seven-section architecture and scope report.
