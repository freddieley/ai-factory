# BOM and component lifecycle

The factory treats a bill of materials as a versioned engineering record, not an untracked JSON field on a work order.

## BOM revisions

Each project can have sequential BOM revisions. A revision contains:

- immutable revision identity and project ownership
- optional work-order association
- ordered BOM items
- component references where a catalog component exists
- quantity and unit
- source (`designed`, `purchased`, or `reused`)
- notes and optional positional metadata
- reason for the revision
- lifecycle status (`draft`, `approved`, `superseded`, `rejected`)

Only one revision can be approved for a project. Approving a new revision automatically supersedes the previously approved revision. Manufacturing consumers should use the approved BOM rather than an arbitrary draft.

## Component lifecycle

Components in the engineering knowledge base have lifecycle states:

`active` → `nrnd` → `obsolete` (or `unknown` when evidence is insufficient).

Lifecycle changes are explicit operations. Every transition records the previous state, new state, reason, timestamp, project, component and optional evidence-claim reference. A component reference in a BOM is project-scoped; cross-project component IDs are rejected.

## API

- `POST /api/projects/:id/boms` — create the next BOM revision.
- `GET /api/projects/:id/boms` — list revisions.
- `GET /api/projects/:id/boms/approved` — retrieve the current approved BOM.
- `GET /api/boms/:id` — retrieve a revision with items.
- `PATCH /api/boms/:id/status` — transition BOM status.
- `GET /api/projects/:id/components/:componentId/lifecycle` — lifecycle history.
- `POST /api/projects/:id/components/:componentId/lifecycle` — record a lifecycle transition.

BOM approval is not a manufacturing authorization. Physical execution remains behind the factory's existing approval and safety boundaries.
