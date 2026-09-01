# Demo Evidence Manifest

Generated with `npm run demo:evidence`.

- `discovered-capability.example.json`: checked-in example capability artifact matching the discovery output contract.
- `scripted-discovery-example/`: discovery-runner evidence produced with an injected scripted decision engine for deterministic review.
- `deterministic-replay/`: live deterministic replay result and JSONL evidence generated without LLM decisions.
- `exceptional-invalid-login/`: exceptional replay outcome showing `known_business_outcome` handling and redaction.
- `llm-discovery/`: location for the genuine LLM-driven discovery run. It is populated when `MINI_AUTO_MODEL_API_KEY` is set.

Committed evidence is sanitized: local absolute paths are replaced with `<repo>`, and sensitive values are redacted.
