# ADR 0001: Use Onion Architecture

Status: accepted

## Context

The target product is a bank back-office automation system with multiple renters or tenants and one vendor-controlled application surface. The interface can be simple, but the business flow is complex: tenants may vary by workflow policy, field labels, route prefixes, risk treatment, evidence retention, and human-review requirements.

Hexagonal architecture would emphasize adapters around external systems. That is useful, but it can put too much attention on the browser/model boundary for this repo. The more important design pressure is protecting workflow policy and tenant-specific business rules from CLI, browser, model, and evidence implementation details.

## Decision

Use Onion Architecture.

The inner domain ring owns capability artifacts, validation, result contracts, workflow policy language, and future tenant overlay concepts. The application ring owns use cases such as discovery, replay, and goal/input enrichment, plus ports such as browser surfaces and evidence stores. The interface ring owns command-line parsing. The infrastructure ring owns concrete OpenAI model-provider calls, Playwright browser automation, memory browser surfaces for tests and demos, and filesystem evidence storage.

## Consequences

Business flow changes should move inward before interface changes move outward. New vendor surfaces, model providers, evidence stores, or operator consoles should depend on application ports instead of changing domain contracts.

The current prototype keeps the browser and evidence implementations behind application ports. Future work should continue this direction for tenant overlays, artifact registries, credential vaults, operator consoles, and remote browser workers.
