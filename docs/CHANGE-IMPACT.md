# Change impact and design review

The factory now treats design changes as traceable events rather than isolated CAD edits.

## Digital thread

Artifacts can be connected through `artifact_links`, and engineering requirements can be explicitly connected to the artifacts that satisfy them through `requirement_artifact_links`. A change-impact analysis starts at a changed artifact and walks downstream artifact lineage. It then reports linked requirements and marks the analysis `critical` when an impacted `must` engineering requirement is not verified as `pass`.

This is intentionally deterministic: the model may propose changes, but the impact graph and gate decision are computed by the control plane.

## API

- `POST /api/projects/:id/requirement-artifact-links`
- `GET /api/projects/:id/requirement-artifact-links`
- `POST /api/projects/:id/impact-analyses` with `{ "artifactId": "..." }`
- `GET /api/projects/:id/impact-analyses`
- `GET /api/impact-analyses/:id`
- `POST /api/projects/:id/design-reviews`
- `GET /api/projects/:id/design-reviews`
- `GET /api/design-reviews/:id`
- `POST /api/design-reviews/:id/findings`
- `POST /api/design-reviews/:id/decision`

## Approval semantics

A design review starts as `pending`. An `approved` decision is rejected by the kernel when either:

1. the review has an open `critical` finding; or
2. the project contains a `must` engineering requirement whose verification status is not `pass`.

A review can be rejected explicitly. Decisions are immutable once made.

This gate is deliberately conservative. Later phases can add richer risk models, simulation evidence, automated root-cause analysis, and policy-specific authorization without weakening the basic invariant that an autonomous proposal cannot silently turn into an approved physical operation.

## Persistence

Migration 11 adds:

- `requirement_artifact_links`
- `impact_analyses`
- `impact_items`
- `design_reviews`
- `design_review_findings`

All are included in the normal SQLite migration path and legacy migration tests.
