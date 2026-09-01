import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/server.js";

describe("factory API contracts", () => {
  let projectId = "";
  let artifactId = "";
  let childArtifactId = "";

  beforeAll(async () => { await app.ready(); });
  afterAll(async () => { await app.close(); });

  it("serves health and capability discovery", async () => {
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual(expect.objectContaining({ ok: true, provider: expect.any(Object) }));
    const capabilities = await app.inject({ method: "GET", url: "/api/capabilities" });
    expect(capabilities.statusCode).toBe(200);
    expect(Array.isArray(capabilities.json())).toBe(true);
  });

  it("creates and reads a project", async () => {
    const invalid = await app.inject({ method: "POST", url: "/api/projects", payload: {} });
    expect(invalid.statusCode).toBe(400);
    const created = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "API contract project", description: "test" } });
    expect(created.statusCode).toBe(200);
    projectId = created.json().id;
    const fetched = await app.inject({ method: "GET", url: `/api/projects/${projectId}` });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().id).toBe(projectId);
    expect((await app.inject({ method: "GET", url: "/api/projects/does-not-exist" })).statusCode).toBe(404);
  });

  it("covers requirements, artifacts, verification, and lineage contracts", async () => {
    expect((await app.inject({ method: "POST", url: `/api/projects/${projectId}/requirements`, payload: {} })).statusCode).toBe(400);
    const req = await app.inject({ method: "POST", url: `/api/projects/${projectId}/requirements`, payload: { key: "width", value: "50", unit: "mm" } });
    expect(req.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/projects/${projectId}/requirements` })).statusCode).toBe(200);
    expect((await app.inject({ method: "PATCH", url: `/api/requirements/${req.json().id}`, payload: { status: "verified" } })).statusCode).toBe(200);

    const first = await app.inject({ method: "POST", url: `/api/projects/${projectId}/artifacts`, payload: { kind: "cad", name: "mounting-plate" } });
    const second = await app.inject({ method: "POST", url: `/api/projects/${projectId}/artifacts`, payload: { kind: "verification", name: "plate-check" } });
    expect(first.statusCode).toBe(200); expect(second.statusCode).toBe(200);
    artifactId = first.json().id; childArtifactId = second.json().id;
    const link = await app.inject({ method: "POST", url: `/api/artifacts/${artifactId}/links`, payload: { childArtifactId, relation: "verified-by" } });
    expect(link.statusCode).toBe(200);
    const artifacts = await app.inject({ method: "GET", url: `/api/projects/${projectId}/artifacts` });
    expect(artifacts.statusCode).toBe(200); expect(artifacts.json().links).toHaveLength(1);

    const verification = await app.inject({ method: "POST", url: `/api/projects/${projectId}/verification`, payload: { status: "pass", evidence: { method: "deterministic-test" } } });
    expect(verification.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/projects/${projectId}/verification` })).statusCode).toBe(200);
  });

  it("covers plans, Fusion links, approvals, work orders, runs, and lifecycle validation", async () => {
    expect((await app.inject({ method: "GET", url: `/api/projects/${projectId}/plan` })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/projects/${projectId}/fusion-link` })).statusCode).toBe(200);
    const fusion = await app.inject({ method: "PUT", url: `/api/projects/${projectId}/fusion-link`, payload: { hubId: "hub-test" } });
    expect(fusion.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/approvals" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/approvals?projectId=${projectId}` })).statusCode).toBe(200);

    const badWorkOrder = await app.inject({ method: "POST", url: `/api/projects/${projectId}/work-orders`, payload: {} });
    expect(badWorkOrder.statusCode).toBe(400);
    const workOrder = await app.inject({ method: "POST", url: `/api/projects/${projectId}/work-orders`, payload: { objective: "build plate", bom: [{ partNumber: "P-1", name: "plate", quantity: 1 }] } });
    expect(workOrder.statusCode).toBe(201);
    expect((await app.inject({ method: "GET", url: `/api/projects/${projectId}/work-orders` })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/work-orders/${workOrder.json().id}` })).statusCode).toBe(200);

    expect((await app.inject({ method: "POST", url: "/api/agent/run", payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/factory/run", payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/runs/does-not-exist" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/runs/does-not-exist/events" })).statusCode).toBe(404);

    const stages = await app.inject({ method: "GET", url: `/api/projects/${projectId}/stages` });
    expect(stages.statusCode).toBe(200); expect(stages.json()).toHaveLength(9);
    expect((await app.inject({ method: "GET", url: `/api/projects/${projectId}/stages/not-a-stage` })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/api/projects/${projectId}/stages/requirements`, payload: { status: "not-a-status" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/api/projects/${projectId}/stages/initialize` })).statusCode).toBe(200);
  });

  it("serves the operator console", async () => {
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("AI Factory");
  });
});
