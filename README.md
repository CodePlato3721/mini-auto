# mini-auto

`mini-auto` is a small TypeScript browser automation prototype for the Sauce Demo checkout workflow. It supports two modes:

- Discovery: an LLM observes a live browser surface and records successful actions into a reusable capability artifact.
- Replay: a saved capability artifact runs deterministically without model calls, with policy checks, redacted evidence, outcome classification, and human handoff.

The repo is organized around Onion Architecture for a bank back-office target domain with multiple renters and one vendor system. Domain contracts live in `src/domain`, application use cases live in `src/application`, CLI concerns live in `src/interfaces`, and concrete OpenAI/Playwright/filesystem adapters live in `src/infrastructure`.

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

Evidence is written to `./evidence` by default. Set `MINI_AUTO_EVIDENCE_DIR` to write elsewhere. `MINI_AUTO_DEBUG_PORT` is optional for replay handoff; it defaults to `9222` and controls the Chromium attach port printed during escalation.

```powershell
$env:MINI_AUTO_EVIDENCE_DIR = "evidence/local-run"
$env:MINI_AUTO_DEBUG_PORT = "9222"
```

In Windows cmd.exe, set the same environment variables with `set`:

```cmd
set MINI_AUTO_EVIDENCE_DIR=evidence/local-run
set MINI_AUTO_DEBUG_PORT=9222
```

Live LLM discovery requires `MINI_AUTO_MODEL_API_KEY`. `MINI_AUTO_MODEL` is optional and defaults to `gpt-5-mini`. Use `MINI_AUTO_PASSWORD` for the workflow password instead of storing it in a JSON file.

```powershell
$env:MINI_AUTO_MODEL_API_KEY = "<your model API key>"
$env:MINI_AUTO_MODEL = "gpt-5-mini"
$env:MINI_AUTO_PASSWORD = "secret_sauce"
```

In cmd.exe:

```cmd
set MINI_AUTO_MODEL_API_KEY=<your model API key>
set MINI_AUTO_MODEL=gpt-5-mini
set MINI_AUTO_PASSWORD=secret_sauce
```

To avoid setting these every time you open a new terminal, create a local `.env` file in the repo root. The CLI automatically loads it when present. Environment variables already set in the terminal take precedence over `.env` values.

```text
MINI_AUTO_EVIDENCE_DIR=evidence/local-run
MINI_AUTO_MODEL_API_KEY=<your model API key>
MINI_AUTO_MODEL=gpt-5-mini
MINI_AUTO_PASSWORD=secret_sauce
MINI_AUTO_DEBUG_PORT=9222
```

Then run the CLI normally:

```cmd
node dist\src\interfaces\cli.js replay-only --artifact artifacts\sauce-demo-checkout.json --goal "Log in as standard_user, add Sauce Labs Backpack to the cart, and complete checkout." --inputs-file inputs.local.json
```

Do not commit `.env`, local input files, raw ad hoc evidence, or API keys. The committed `evidence/demo/` files are sanitized; local evidence outside that folder stays ignored by git. The Sauce Demo password is treated as sensitive input and is redacted in replay and discovery logs.

Keep `inputs.local.json` to non-secret checkout fields. Pass the username and product in `--goal`; the CLI infers known Sauce Demo usernames and product names from the goal.

```json
{
  "firstName": "Ada",
  "lastName": "Lovelace",
  "postalCode": "90210"
}
```

## Run Without Live Model Calls

Deterministic replay needs no model key. Use the checked-in artifact, pass the product in `--goal`, and set the password in `MINI_AUTO_PASSWORD`. Handoff is enabled by default for replay; the final checkout submit is marked `risky`, so the end-to-end demo pauses for operator review before final submit:

```powershell
npm run build
$env:MINI_AUTO_PASSWORD = "secret_sauce"
node dist\src\interfaces\cli.js replay-only --artifact artifacts\sauce-demo-checkout.json --goal "Log in as standard_user, add Sauce Labs Backpack to the cart, and complete checkout." --inputs-file inputs.local.json
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
node dist\src\interfaces\cli.js discover --goal "Log in as standard_user to Sauce Demo, add Sauce Labs Backpack to the cart, complete checkout with fake customer data, and verify the order confirmation." --target-url "https://www.saucedemo.com/" --inputs-file inputs.local.json
```

Replay the artifact produced by that discovery run:

```powershell
node dist\src\interfaces\cli.js replay-only --artifact evidence\live-discovery\discovered-capability.json --goal "Log in as standard_user, add Sauce Labs Backpack to the cart, and complete checkout." --inputs-file inputs.local.json
```

## Exceptional Outcome Demo

Invalid login is classified as a known business outcome instead of an infrastructure failure:

```powershell
$env:MINI_AUTO_PASSWORD = "wrong_password"
node dist\src\interfaces\cli.js replay-only --artifact artifacts\sauce-demo-checkout.json --goal "Log in as standard_user, add Sauce Labs Backpack to the cart, and complete checkout." --inputs-file inputs.local.json
```

## Human Handoff Demo

Replay pauses by default on explicit `handoff` steps, risky actions, or stuck replay states. It launches a headed Chromium session so the operator can act directly in the browser, prints the intervention request and attach instructions, then waits for the operator to type `resume`, `resume: <what changed>`, or `fail <reason>`. After resume, replay reconciles the current page with the remaining artifact steps and continues from the first step that is executable in the live session. Set `MINI_AUTO_DEBUG_PORT` if port `9222` is already in use.

```powershell
$env:MINI_AUTO_PASSWORD = "secret_sauce"
node dist\src\interfaces\cli.js replay --artifact artifacts\sauce-demo-checkout.json --goal "Log in as standard_user, add Sauce Labs Backpack to the cart, and complete checkout." --inputs-file inputs.local.json
```

The checked-in Sauce Demo artifact marks `finish-checkout` as `risky`, so this command pauses before the final submit even when the happy path is otherwise working.

## Design Report

See [docs/design-report.md](docs/design-report.md) for the required seven-section architecture and scope report.
