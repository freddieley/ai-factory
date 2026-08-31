import { db } from "./db.js";
import { randomUUID } from "node:crypto";
import type { Requirement, EngineeringPlan } from "./engineering.js";

db.exec(`
CREATE TABLE IF NOT EXISTS requirements (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
 value TEXT, unit TEXT, priority TEXT NOT NULL, verification_method TEXT,
 verification_status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS engineering_plans (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, objective TEXT NOT NULL, plan_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fusion_links (
 project_id TEXT PRIMARY KEY, hub_id TEXT, fusion_project_id TEXT, design_id TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS verification_records (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_id TEXT, requirement_id TEXT,
 status TEXT NOT NULL, evidence TEXT NOT NULL, created_at TEXT NOT NULL
);
`);

export function saveRequirements(projectId: string, requirements: Requirement[]) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`INSERT INTO requirements
    (id,project_id,description,category,value,unit,priority,verification_method,verification_status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET description=excluded.description,category=excluded.category,value=excluded.value,unit=excluded.unit,priority=excluded.priority,verification_method=excluded.verification_method,verification_status=excluded.verification_status,updated_at=excluded.updated_at`);
  db.transaction(() => requirements.forEach(r => stmt.run(r.id, projectId, r.description, r.category, r.value == null ? null : String(r.value), r.unit ?? null, r.priority, r.verificationMethod ?? null, r.verificationStatus, now, now)))();
}
export function listRequirements(projectId: string) { return db.prepare(`SELECT * FROM requirements WHERE project_id=? ORDER BY created_at`).all(projectId); }
export function savePlan(projectId: string, plan: EngineeringPlan) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO engineering_plans (id,project_id,objective,plan_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET objective=excluded.objective,plan_json=excluded.plan_json,updated_at=excluded.updated_at`).run(plan.id, projectId, plan.objective, JSON.stringify(plan), "draft", now, now);
}
export function getPlan(projectId: string) {
  const row = db.prepare(`SELECT plan_json FROM engineering_plans WHERE project_id=? ORDER BY updated_at DESC LIMIT 1`).get(projectId) as { plan_json: string } | undefined;
  return row ? JSON.parse(row.plan_json) as EngineeringPlan : null;
}
export function linkFusionProject(projectId: string, link: { hubId?: string; fusionProjectId?: string; designId?: string }) {
  db.prepare(`INSERT INTO fusion_links(project_id,hub_id,fusion_project_id,design_id,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET hub_id=excluded.hub_id,fusion_project_id=excluded.fusion_project_id,design_id=excluded.design_id,updated_at=excluded.updated_at`).run(projectId, link.hubId ?? null, link.fusionProjectId ?? null, link.designId ?? null, new Date().toISOString());
}
export function getFusionLink(projectId: string) { return db.prepare(`SELECT * FROM fusion_links WHERE project_id=?`).get(projectId); }
export function addVerificationRecord(input: { projectId: string; runId?: string; requirementId?: string; status: "pass" | "fail" | "blocked"; evidence: unknown }) {
  const id = randomUUID();
  db.prepare(`INSERT INTO verification_records (id,project_id,run_id,requirement_id,status,evidence,created_at) VALUES (?,?,?,?,?,?,?)`).run(id, input.projectId, input.runId ?? null, input.requirementId ?? null, input.status, JSON.stringify(input.evidence), new Date().toISOString());
  return id;
}
