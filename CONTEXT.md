# Mini Auto Context

Mini Auto is a prototype automation runner for bank back-office workflows. The intended production domain has multiple renters or tenants operating through one vendor-controlled system. Tenant workflows can diverge in policy, labels, route prefixes, and review requirements even when the vendor interface remains visually simple.

The project uses Onion Architecture because the business workflow is more complex than the interface technology. Domain contracts and business concepts sit at the center, application use cases orchestrate discovery and replay, interfaces handle CLI input, and infrastructure adapters handle HTTP model calls, browser automation, and evidence persistence.

Current demo artifacts use Sauce Demo as a small stand-in for vendor workflow automation. Sauce Demo input inference remains an application concern so the CLI does not own business parsing rules.

Primary rings:

- `src/domain`: artifact schemas, result contracts, and domain validation.
- `src/application`: replay, discovery, input enrichment use cases, and ports.
- `src/interfaces`: CLI interface adapters.
- `src/infrastructure`: OpenAI model adapters, Playwright browser adapters, memory test browser adapters, and filesystem evidence storage.

Workflow policy, tenant overlay rules, and replay outcomes should remain independent from any UI driver or storage backend.
