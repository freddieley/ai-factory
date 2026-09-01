# Engineering evidence

The evidence layer is the factory's boundary between an engineering assertion and the source that supports it.

## Model

- **Evidence source**: a project-scoped provenance record describing where information came from, when it was observed, how long it remains valid, and confidence in it.
- **Evidence claim**: an engineering statement tied to exactly one evidence source. Claims can be active, superseded, or disputed.
- **Freshness**: a source is considered expired when `expires_at` is present and earlier than the current time. Sources without an expiry are not treated as expired.
- **Content hash**: optional hash for detecting that the referenced source content changed.

## API

- `GET /api/projects/:id/evidence` — sources, claims, and freshness summary.
- `GET /api/projects/:id/evidence/search?q=...` — project-scoped claim retrieval. Current evidence ranks before expired evidence, then confidence and recency.
- `POST /api/projects/:id/evidence/sources` — register provenance.
- `POST /api/projects/:id/evidence/claims` — record a claim against a source.

## Factory rule

Agents should not silently convert an unsupported assertion into a hard engineering requirement. Planning and review layers should preserve the evidence references that justify consequential decisions. Expired or low-confidence evidence should trigger re-validation when the decision depends on it.

The current implementation stores and retrieves evidence locally; external crawling/connectors, semantic retrieval, source refresh jobs, and automatic claim extraction are later roadmap work.
