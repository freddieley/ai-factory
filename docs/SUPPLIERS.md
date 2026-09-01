# Supplier and procurement knowledge

The supplier layer turns an engineering component requirement into traceable procurement options without pretending that stale catalogue data is current inventory.

## Data model

- **Supplier** — project-scoped organisation with stable code, identity, status, and optional provenance.
- **Supplier offer** — an observed offer for one component from one supplier. It records supplier part number, unit price/currency, availability, stock when known, lead time, minimum order quantity, pack quantity, observation time, expiry, and provenance.
- **Approved source** — an explicit engineering/procurement approval connecting a component to a supplier and optionally to one exact observed offer. Approval records who approved it, why, validity, and current status.

Supplier records and offers are project-isolated. An offer cannot reference a component or supplier from another project, and an approved source cannot reference an unrelated offer.

## Procurement ranking

`GET /api/projects/:id/components/:componentId/procurement-options` returns offers ordered by availability first (`in_stock`, then `backorder`, then other states), then price, then known lead time. This is a discovery ranking, not an automatic purchase decision.

Offer freshness is represented by `observed_at` and `expires_at`. Consumers should treat expired or otherwise stale offers as requiring revalidation before procurement.

## API

- `GET/POST /api/projects/:id/suppliers`
- `GET/POST /api/projects/:id/supplier-offers`
- `GET /api/projects/:id/components/:componentId/procurement-options`
- `GET/POST /api/projects/:id/approved-sources`

All write endpoints validate their payloads and enforce project isolation. Physical purchasing remains outside this layer and must eventually pass through the factory's authorization, budget, inventory, and manufacturing controls.

## Future integration

The next procurement iterations should add connector adapters for approved supplier/catalogue sources, normalise identifiers and currencies, refresh observations, detect component substitutions, and feed procurement feasibility into BOM validation and manufacturing scheduling. External data should enter through the same evidence/provenance model rather than becoming untraceable agent context.
